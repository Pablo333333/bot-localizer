import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { GoogleSpreadsheetRow } from 'google-spreadsheet';
import { SheetsService } from '../../sheets/sheets.service';
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
  findAnuncioRevisadoHeader,
  isAnuncioRevisadoSi,
} from './anuncio-revisado';

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
 * Localizados → WordPress cuando "Anuncio Revisado?" = SI (por nombre de cabecera).
 * Crea el post si no hay ID_WP; si existe, actualiza salvo protección de publicados.
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
      const reviewHeader = findAnuncioRevisadoHeader(headers);

      if (!reviewHeader) {
        this.logger.warn(
          'Columna "Anuncio Revisado?" no encontrada por nombre — sync omitido.',
        );
        return stats;
      }

      stats.scanned = rows.length;

      for (const row of rows) {
        const sheetRowNumber = row.rowNumber;
        if (rowNumber !== undefined && sheetRowNumber !== rowNumber) {
          continue;
        }

        if (!isAnuncioRevisadoSi(row, headers)) {
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

  private async processReviewedRow(
    sheet: Parameters<SheetsService['updateTrackingCells']>[0],
    row: GoogleSpreadsheetRow,
    headers: string[],
    options: { force?: boolean } = {},
  ): Promise<'created' | 'updated' | 'skipped'> {
    const callData = sheetRowToCallData(row);
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
    await this.sheetsService.updateSpecificCells(sheet, row.rowNumber, {
      [COL_DESCRIPCION_PROPIETARIO]: commercialContent,
      [COL_DESCRIPCION_PROPIETARIO_ALT]: commercialContent,
    });

    const media = await this.propertyMedia.resolveAndUploadPropertyMedia(
      cad,
      callData.call_id,
      { postId: existingPostId },
    );

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
