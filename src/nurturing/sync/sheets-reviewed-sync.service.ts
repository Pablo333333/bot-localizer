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

export type ReviewedWpSyncPost = {
  rowNumber: number;
  postId: number;
  action: 'created' | 'updated';
  url: string;
};

export type ReviewedWpSyncStats = {
  scanned: number;
  eligible: number;
  created: number;
  updated: number;
  skipped: number;
  errors: number;
  missing?: number[];
  posts?: ReviewedWpSyncPost[];
};

type RowSyncResult =
  | { status: 'created' | 'updated'; postId: number }
  | { status: 'skipped' };

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
      this.logger.warn(
        `Reviewed→WP sync omitido: ${error instanceof Error ? error.message : error}. Llamadas y seguimiento siguen.`,
      );
    }
  }

  /**
   * @param rowNumber Fila 1-based del Sheet (opcional; si se omite, procesa todas las SI).
   * @param options.force Con fila concreta, ignora sandbox, Publicación Autorizada? y bloqueos temporales.
   */
  async syncReviewedRowsToWordpress(
    rowNumber?: number,
    options: { force?: boolean } = {},
  ): Promise<ReviewedWpSyncStats> {
    const forceThisRow = options.force === true && rowNumber !== undefined;
    if (this.running && !forceThisRow) {
      return {
        scanned: 0,
        eligible: 0,
        created: 0,
        updated: 0,
        skipped: 0,
        errors: 0,
        posts: [],
      };
    }
    const ownsLock = !this.running;
    if (ownsLock) this.running = true;

    const stats: ReviewedWpSyncStats = {
      scanned: 0,
      eligible: 0,
      created: 0,
      updated: 0,
      skipped: 0,
      errors: 0,
      posts: [],
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
          if (!forceThisRow) {
            stats.skipped += 1;
            continue;
          }
          this.logger.warn(
            `Fila ${sheetRowNumber}: force sync — Publicación Autorizada? no es SI; se publica igual por autorización explícita.`,
          );
        }

        if (!forceThisRow && !this.allowRowInSandbox(row, sheetRowNumber)) {
          stats.skipped += 1;
          continue;
        }

        stats.eligible += 1;

        try {
          const result = await this.processReviewedRow(sheet, row, headers, {
            force: forceThisRow,
            ignoreSheetBlock: forceThisRow,
          });
          this.tallyRowResult(stats, sheetRowNumber, result);
        } catch (err) {
          stats.errors += 1;
          this.logger.warn(
            `Fila ${sheetRowNumber} Reviewed→WP omitida: ${
              err instanceof Error ? err.message : err
            }. El resto de filas, llamadas y seguimiento siguen.`,
          );
        }
      }

      this.logger.log(
        `Reviewed→WP sync: scanned=${stats.scanned} eligible=${stats.eligible} created=${stats.created} updated=${stats.updated} skipped=${stats.skipped} errors=${stats.errors} forceRow=${forceThisRow ? rowNumber : '-'}`,
      );
      return stats;
    } finally {
      if (ownsLock) this.running = false;
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
      posts: [],
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
        this.tallyRowResult(stats, row.rowNumber, result);
      } catch (err) {
        stats.errors += 1;
        this.logger.warn(
          `WP post ${postId} fila ${row.rowNumber} omitido: ${
            err instanceof Error ? err.message : err
          }. Llamadas y seguimiento siguen.`,
        );
      }
    }

    this.logger.log(
      `WP IDs sync: ids=${uniqueIds.join(',')} force=${!!options.force} created=${stats.created} updated=${stats.updated} skipped=${stats.skipped} missing=${stats.missing?.join(',') || '-'} errors=${stats.errors}`,
    );
    return stats;
  }

  private tallyRowResult(
    stats: ReviewedWpSyncStats,
    rowNumber: number,
    result: RowSyncResult,
  ): void {
    if (result.status === 'skipped') {
      stats.skipped += 1;
      return;
    }
    if (result.status === 'created') stats.created += 1;
    else stats.updated += 1;
    const base = String(this.config.get('WP_URL') || 'https://www.localicer.com').replace(
      /\/$/,
      '',
    );
    stats.posts = stats.posts || [];
    stats.posts.push({
      rowNumber,
      postId: result.postId,
      action: result.status,
      url: `${base}/?p=${result.postId}`,
    });
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
    options: { force?: boolean; ignoreSheetBlock?: boolean } = {},
  ): Promise<RowSyncResult> {
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
        ignoreSheetBlock: options.ignoreSheetBlock === true,
      });
      if (guard.skip) {
        this.logger.warn(
          `Fila ${row.rowNumber}: ${guard.reason} — cambios manuales en WP protegidos`,
        );
        return { status: 'skipped' };
      }
    }

    const commercialContent = await this.commercialDescription.resolve(
      cad,
      callData.call_analysis.call_summary,
    );
    cad.descripcion_propietario = commercialContent;
    this.logger.log(
      `Fila ${row.rowNumber} media Sheet URL Imagen (col P)=${String(cad.url_imagen || '').slice(0, 120) || '(vacío)'} carpeta_drive=${String(cad.carpeta_drive || '').slice(0, 120) || '(vacío)'}`,
    );
    await this.sheetsService.updateSpecificCells(
      sheet,
      row.rowNumber,
      {
        [COL_DESCRIPCION_PROPIETARIO]: commercialContent,
        [COL_DESCRIPCION_PROPIETARIO_ALT]: commercialContent,
      },
      row,
    );

    let media: { featuredMediaId?: number; galleryMediaIds: number[] } = {
      galleryMediaIds: [],
    };
    try {
      media = await this.propertyMedia.resolveAndUploadPropertyMedia(
        cad,
        callData.call_id,
        { postId: existingPostId },
      );
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `Fila ${row.rowNumber}: subida de imágenes a WordPress omitida: ${message}. Se sigue sin galería.`,
      );
    }

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

    const upserted = await this.wordpress.upsertPropertyFromCallData(callData, {
      postId: existingPostId,
      featuredMediaId: media.featuredMediaId,
      galleryMediaIds: media.galleryMediaIds,
      status,
      preserveStatus,
      commercialContent,
    });

    if (!upserted?.id) {
      this.logger.warn(
        `Fila ${row.rowNumber}: WordPress no creó ni actualizó la entrada. Se omite el write-back; llamadas y seguimiento siguen.`,
      );
      return { status: 'skipped' };
    }

    const { id: postId, created } = upserted;

    try {
      if (media.galleryMediaIds.length > 0) {
        await this.propertyMedia.attachGalleryToProperty(
          postId,
          media.galleryMediaIds,
        );
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `Fila ${row.rowNumber}: galería WP omitida en post ${postId}: ${message}.`,
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
    return {
      status: created ? 'created' : 'updated',
      postId,
    };
  }
}
