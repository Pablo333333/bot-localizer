import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { GoogleSpreadsheetRow } from 'google-spreadsheet';
import { GoogleDriveService } from '../../google/google-drive.service';
import { SheetsService } from '../../sheets/sheets.service';
import { extractImageUrlFromCad } from '../../wordpress/property-mapper';
import {
  readWpPostIdFromSheetRow,
  sheetRowToCallData,
} from '../../wordpress/sheet-row-mapper';
import { WordpressService } from '../../wordpress/wordpress.service';
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
};

/**
 * Localizados → WordPress cuando "Anuncio Revisado?" (columna J) = SI.
 * Crea el post si no hay ID_WP / WP Post ID; si existe, actualiza (idempotente).
 */
@Injectable()
export class SheetsReviewedSyncService {
  private readonly logger = new Logger(SheetsReviewedSyncService.name);
  private running = false;

  constructor(
    private readonly sheetsService: SheetsService,
    private readonly wordpress: WordpressService,
    private readonly googleDrive: GoogleDriveService,
    private readonly config: ConfigService,
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
      const doc = this.sheetsService.getDoc();
      const sheet = doc.sheetsByTitle[SHEET_NAME] || doc.sheetsByIndex[0];
      await sheet.loadHeaderRow();
      const headers = sheet.headerValues || [];
      const reviewHeader = findAnuncioRevisadoHeader(headers);

      if (!reviewHeader) {
        this.logger.warn(
          'Columna "Anuncio Revisado?" (J) no encontrada — sync omitido.',
        );
        return stats;
      }

      const rows = await sheet.getRows();
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
          const result = await this.processReviewedRow(sheet, row, headers);
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

  private async processReviewedRow(
    sheet: Parameters<SheetsService['updateTrackingCells']>[0],
    row: GoogleSpreadsheetRow,
    headers: string[],
  ): Promise<'created' | 'updated' | 'skipped'> {
    const callData = sheetRowToCallData(row);
    const cad = callData.call_analysis.custom_analysis_data;
    const existingPostId = readWpPostIdFromSheetRow(row);
    const featuredMediaId = await this.resolveFeaturedMediaId(
      cad,
      callData.call_id,
    );

    const status =
      this.config.get<string>('WP_REVIEWED_POST_STATUS') ||
      this.config.get<string>('WP_POST_STATUS') ||
      'pending';

    const { id: postId, created } = await this.wordpress.upsertPropertyFromCallData(
      callData,
      {
        postId: existingPostId,
        featuredMediaId,
        status,
      },
    );

    if (!postId) {
      this.logger.warn(`Fila ${row.rowNumber}: WP no devolvió ID — omitiendo write-back`);
      return 'skipped';
    }

    await this.sheetsService.writeWordPressPublishWriteback(
      sheet,
      row.rowNumber,
      postId,
    );

    this.logger.log(
      `Fila ${row.rowNumber} Reviewed→WP ${created ? 'CREADO' : 'ACTUALIZADO'} post_id=${postId} | Propietario contactado?=SI`,
    );
    return created ? 'created' : 'updated';
  }

  private async resolveFeaturedMediaId(
    cad: Record<string, unknown> | undefined,
    callId?: string,
  ): Promise<number | undefined> {
    const imageUrl = extractImageUrlFromCad(cad);
    if (imageUrl) {
      try {
        const { buffer, fileName, mimeType } =
          await this.googleDrive.downloadImageFromUrl(imageUrl);
        return await this.wordpress.uploadMedia(
          buffer,
          fileName || `sheet_row_${callId || 'img'}.jpg`,
          mimeType,
        );
      } catch (err: any) {
        this.logger.warn(
          `No se pudo subir imagen desde URL del Sheet: ${err.message}`,
        );
      }
    }

    const rootFolderId = this.config.get<string>('DRIVE_ROOT_FOLDER_ID');
    if (!rootFolderId || !callId) {
      return undefined;
    }

    try {
      const images = await this.googleDrive.getImagesFromFolder(
        rootFolderId,
        callId,
      );
      if (images.length === 0) {
        return undefined;
      }
      const buffer = await this.googleDrive.downloadImageBuffer(images[0].id!);
      return await this.wordpress.uploadMedia(
        buffer,
        images[0].name || `call_${callId}.jpg`,
      );
    } catch (err: any) {
      this.logger.warn(`Fallback Drive por call_id falló: ${err.message}`);
      return undefined;
    }
  }
}
