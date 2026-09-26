import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { SheetsService } from '../../sheets/sheets.service';
import type { IsolatedSheetRow } from '../../sheets/sheet-row-isolation';
import {
  readWpPostIdFromSheetRow,
  sheetRowToCallData,
} from '../../wordpress/sheet-row-mapper';
import { WordpressService } from '../../wordpress/wordpress.service';
import { CommercialDescriptionService } from '../../wordpress/commercial-description.service';
import { PropertyMediaService } from '../../wordpress/property-media.service';
import {
  COL_DESCRIPCION_PROPIETARIO,
  COL_DESCRIPCION_PROPIETARIO_ALT,
  TONI_TEST_WP_POST_IDS,
} from '../../wordpress/wpresidence.constants';
import {
  isWpSyncProtectPublishedEnabled,
  readBloquearSyncWp,
  readForzarSyncWp,
  shouldSkipWpOverwrite,
} from '../../wordpress/wp-sync-guard';
import {
  findPublicacionAutorizadaHeader,
  isPublicacionAutorizadaSi,
} from '../../outbound/publicacion-autorizada';
import {
  OUTBOUND_SANDBOX_WHITELIST_E164,
  SKIPPED_SANDBOX_WHITELIST,
  isOutboundSandboxWhitelistEnabled,
  isSheetRowAllowedInSandbox,
} from '../../outbound/outbound-sandbox-whitelist';

const SHEET_NAME = 'Localizados';

export type ReviewedWpSyncStats = {
  scanned: number;
  eligible: number;
  created: number;
  updated: number;
  skipped: number;
  errors: number;
  missing?: number[];
};

/**
 * Localizados → WordPress cuando "Publicación Autorizada?" = SI (por nombre de cabecera).
 * Sube imágenes Drive a la biblioteca WP y crea el post pending con destacada + galería.
 * Crea el post si no hay ID_WP; si existe, actualiza salvo protección de publicados.
 * Con OUTBOUND_SANDBOX_WHITELIST_ENABLED, solo la fila de Toni (+34644408099).
 */
@Injectable()
export class SheetsReviewedSyncService {
  private readonly logger = new Logger(SheetsReviewedSyncService.name);
  private running = false;

  constructor(
    private readonly sheetsService: SheetsService,
    private readonly wordpress: WordpressService,
    private readonly propertyMedia: PropertyMediaService,
    private readonly config: ConfigService,
    private readonly commercialDescription: CommercialDescriptionService,
  ) {}

  isEnabled(): boolean {
    const raw = this.config.get<string>('REVIEWED_ANUNCIO_WP_SYNC_ENABLED');
    if (raw === undefined || raw === null || String(raw).trim() === '') {
      return true;
    }
    return ['true', '1', 'yes', 'si', 'sí'].includes(
      String(raw).trim().toLowerCase(),
    );
  }

  @Cron(CronExpression.EVERY_10_MINUTES)
  async scheduledSync(): Promise<void> {
    if (!this.isEnabled()) {
      return;
    }
    try {
      await this.syncReviewedRowsToWordpress();
    } catch (error) {
      this.logger.error(
        `Reviewed→WP sync failed: ${error instanceof Error ? error.message : error}`,
      );
    }
  }

  /**
   * @param rowNumber Fila 1-based del Sheet (opcional; si se omite, procesa todas las SI).
   */
  async syncReviewedRowsToWordpress(
    rowNumber?: number,
  ): Promise<ReviewedWpSyncStats> {
    if (this.running) {
      return {
        scanned: 0,
        eligible: 0,
        created: 0,
        updated: 0,
        skipped: 0,
        errors: 0,
      };
    }
    this.running = true;

    const stats: ReviewedWpSyncStats = {
      scanned: 0,
      eligible: 0,
      created: 0,
      updated: 0,
      skipped: 0,
      errors: 0,
    };

    try {
      const { sheet, rows } = await this.sheetsService.getAllRows(SHEET_NAME);
      const headers = sheet.headerValues || [];
      const pubHeader = findPublicacionAutorizadaHeader(headers);

      if (!pubHeader) {
        this.logger.warn(
          'Columna "Publicación Autorizada?" no encontrada por nombre — sync omitido.',
        );
        return stats;
      }

      stats.scanned = rows.length;
      this.logSandboxScope();

      for (const row of rows) {
        const sheetRowNumber = row.rowNumber;
        if (rowNumber !== undefined && sheetRowNumber !== rowNumber) {
          continue;
        }

        if (!isPublicacionAutorizadaSi(row, headers)) {
          stats.skipped += 1;
          continue;
        }

        if (!this.allowRowInSandbox(row, sheetRowNumber)) {
          stats.skipped += 1;
          continue;
        }

        stats.eligible += 1;

        try {
          const result = await this.processReviewedRow(sheet, row, headers, {
            force: false,
          });
          if (result === 'created') stats.created += 1;
          else if (result === 'updated') stats.updated += 1;
          else stats.skipped += 1;
        } catch (err) {
          stats.errors += 1;
          this.logger.error(
            `Fila ${sheetRowNumber} Reviewed→WP error: ${
              err instanceof Error ? err.message : err
            }`,
          );
        }
      }

      this.logger.log(
        `Reviewed→WP sync: scanned=${stats.scanned} eligible=${stats.eligible} created=${stats.created} updated=${stats.updated} skipped=${stats.skipped} errors=${stats.errors}`,
      );
      return stats;
    } finally {
      this.running = false;
    }
  }

  /**
   * Reprocesa estate_property concretos (p.ej. IDs de prueba de Toni).
   * @param force si true, permite sobrescribir posts publicados (query ?force=1).
   */
  async syncWordpressPostsByIds(
    postIds: number[] = [...TONI_TEST_WP_POST_IDS],
    options: { force?: boolean } = {},
  ): Promise<ReviewedWpSyncStats> {
    const stats: ReviewedWpSyncStats = {
      scanned: 0,
      eligible: 0,
      created: 0,
      updated: 0,
      skipped: 0,
      errors: 0,
      missing: [],
    };

    const uniqueIds = [...new Set(postIds.filter((n) => Number.isFinite(n)))];
    const { sheet, rows } = await this.sheetsService.getAllRows(SHEET_NAME);
    const headers = sheet.headerValues || [];
    stats.scanned = rows.length;
    this.logSandboxScope();

    for (const postId of uniqueIds) {
      const row = rows.find((r) => readWpPostIdFromSheetRow(r) === postId);
      if (!row) {
        stats.missing?.push(postId);
        stats.errors += 1;
        this.logger.warn(
          `WP post ${postId}: no hay fila en Localizados con ese ID_WP`,
        );
        continue;
      }

      if (!this.allowRowInSandbox(row, row.rowNumber)) {
        stats.skipped += 1;
        continue;
      }

      stats.eligible += 1;
      try {
        const result = await this.processReviewedRow(sheet, row, headers, {
          force: options.force === true,
        });
        if (result === 'created') stats.created += 1;
        else if (result === 'updated') stats.updated += 1;
        else stats.skipped += 1;
      } catch (err) {
        stats.errors += 1;
        this.logger.error(
          `WP post ${postId} fila ${row.rowNumber} error: ${
            err instanceof Error ? err.message : err
          }`,
        );
      }
    }

    this.logger.log(
      `WP IDs sync: ids=${uniqueIds.join(',')} force=${!!options.force} created=${stats.created} updated=${stats.updated} skipped=${stats.skipped} missing=${stats.missing?.join(',') || '-'} errors=${stats.errors}`,
    );
    return stats;
  }

  private logSandboxScope(): void {
    if (
      !isOutboundSandboxWhitelistEnabled(
        this.config.get('OUTBOUND_SANDBOX_WHITELIST_ENABLED'),
      )
    ) {
      return;
    }
    this.logger.warn(
      `[SANDBOX WHITELIST] Reviewed→WP solo filas con ${OUTBOUND_SANDBOX_WHITELIST_E164}. El resto de SI se omite.`,
    );
  }

  private allowRowInSandbox(
    row: { get: (header: string) => unknown },
    rowNumber: number,
  ): boolean {
    const envRaw = this.config.get('OUTBOUND_SANDBOX_WHITELIST_ENABLED');
    if (isSheetRowAllowedInSandbox(row, envRaw)) return true;
    this.logger.log(
      `Fila ${rowNumber} ${SKIPPED_SANDBOX_WHITELIST} — Reviewed→WP solo ${OUTBOUND_SANDBOX_WHITELIST_E164}`,
    );
    return false;
  }

  private async processReviewedRow(
    sheet: Parameters<SheetsService['updateTrackingCells']>[0],
    row: IsolatedSheetRow,
    headers: string[],
    options: { force?: boolean } = {},
  ): Promise<'created' | 'updated' | 'skipped'> {
    const callData = sheetRowToCallData(row, headers);
    const cad = callData.call_analysis.custom_analysis_data;
    const existingPostId = readWpPostIdFromSheetRow(row);

    const forzarSync = options.force === true || readForzarSyncWp(row);
    const bloquearSync = readBloquearSyncWp(row);
    const protectPublished = isWpSyncProtectPublishedEnabled(
      this.config.get('WP_SYNC_PROTECT_PUBLISHED'),
    );

    let wpStatus: string | null = null;
    if (existingPostId) {
      const brief = await this.wordpress.getEstatePropertyBrief(existingPostId);
      wpStatus = brief?.status ?? null;
      const guard = shouldSkipWpOverwrite({
        existingPostId,
        wpStatus,
        protectPublished,
        forzarSync,
        bloquearSync,
      });
      if (guard.skip) {
        this.logger.warn(
          `Fila ${row.rowNumber}: ${guard.reason} — cambios manuales en WP protegidos`,
        );
        return 'skipped';
      }
    }

    const commercialContent = await this.commercialDescription.resolve(
      cad,
      callData.call_analysis.call_summary,
    );
    cad.descripcion_propietario = commercialContent;
    this.logger.log(
      `Fila ${row.rowNumber} media Sheet url_imagen=${String(cad.url_imagen || '').slice(0, 120) || '(vacío)'} carpeta_drive=${String(cad.carpeta_drive || '').slice(0, 120) || '(vacío)'}`,
    );
    await this.sheetsService.updateSpecificCells(sheet, row.rowNumber, {
      [COL_DESCRIPCION_PROPIETARIO]: commercialContent,
      [COL_DESCRIPCION_PROPIETARIO_ALT]: commercialContent,
    });

    const media = await this.propertyMedia.resolveAndUploadPropertyMedia(
      cad,
      callData.call_id,
      { postId: existingPostId },
    );

    if (!media.featuredMediaId && media.galleryMediaIds.length === 0) {
      this.logger.warn(
        `Fila ${row.rowNumber}: sin imágenes en WP (Drive no descargó / no subió). Se crea el pending igual.`,
      );
    }

    const status =
      this.config.get<string>('WP_REVIEWED_POST_STATUS') ||
      this.config.get<string>('WP_POST_STATUS') ||
      'pending';

    const preserveStatus =
      !!existingPostId &&
      (wpStatus === 'publish' || forzarSync);

    const { id: postId, created } =
      await this.wordpress.upsertPropertyFromCallData(callData, {
        postId: existingPostId,
        featuredMediaId: media.featuredMediaId,
        galleryMediaIds: media.galleryMediaIds,
        status,
        preserveStatus,
        commercialContent,
      });

    if (!postId) {
      this.logger.warn(
        `Fila ${row.rowNumber}: WP no devolvió ID — omitiendo write-back`,
      );
      return 'skipped';
    }

    if (media.galleryMediaIds.length > 0) {
      await this.propertyMedia.attachGalleryToProperty(
        postId,
        media.galleryMediaIds,
      );
    }

    await this.sheetsService.writeWordPressPublishWriteback(
      sheet,
      row.rowNumber,
      postId,
    );

    this.logger.log(
      `Fila ${row.rowNumber} Reviewed→WP ${created ? 'CREADO' : 'ACTUALIZADO'} post_id=${postId} featured=${media.featuredMediaId || '-'} gallery=${media.galleryMediaIds.length} | Propietario contactado?=SI`,
    );
    return created ? 'created' : 'updated';
  }
}
