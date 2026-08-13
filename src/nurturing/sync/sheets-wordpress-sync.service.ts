import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { GoogleSpreadsheetRow } from 'google-spreadsheet';
import { SheetsService } from '../../sheets/sheets.service';
import { WordpressService } from '../../wordpress/wordpress.service';

const SHEET_NAME = 'Localizados';
const COL_WP_POST_ID = 'WP Post ID';
const COL_TIPO = 'Tipo de inmueble';
const COL_MUNICIPIO = 'Municipio';
const COL_PRECIO_ALQUILER = 'Precio ALQUILER/mes';
const COL_PRECIO_VENTA = 'Precio VENTA';
const COL_DISPONIBILIDAD = 'Disponibilidad del local';
const COL_ESTADO = 'Estado';

/**
 * Sheets → WordPress: si la fila tiene "WP Post ID", sincroniza campos clave al post.
 * Toni: al modificar datos en Sheets, actualizar la propiedad en WP.
 */
@Injectable()
export class SheetsWordpressSyncService {
  private readonly logger = new Logger(SheetsWordpressSyncService.name);
  private running = false;

  constructor(
    private readonly sheetsService: SheetsService,
    private readonly wordpress: WordpressService,
  ) {}

  @Cron(CronExpression.EVERY_30_MINUTES)
  async scheduledSync(): Promise<void> {
    try {
      await this.syncSheetRowsToWordpress();
    } catch (error) {
      this.logger.error(
        `Sheets→WP sync failed: ${error instanceof Error ? error.message : error}`,
      );
    }
  }

  async syncSheetRowsToWordpress(): Promise<{
    scanned: number;
    updated: number;
    skipped: number;
    errors: number;
  }> {
    if (this.running) {
      return { scanned: 0, updated: 0, skipped: 0, errors: 0 };
    }
    this.running = true;

    let updated = 0;
    let skipped = 0;
    let errors = 0;

    try {
      const doc = this.sheetsService.getDoc();
      const sheet = doc.sheetsByTitle[SHEET_NAME] || doc.sheetsByIndex[0];
      await sheet.loadHeaderRow();
      const headers = new Set(sheet.headerValues || []);

      if (!headers.has(COL_WP_POST_ID)) {
        this.logger.warn(
          `Columna "${COL_WP_POST_ID}" no existe en Sheets — sync WP omitido. Añade la columna con el ID del post.`,
        );
        return { scanned: 0, updated: 0, skipped: 0, errors: 0 };
      }

      const rows = await sheet.getRows();
      for (const row of rows) {
        const postIdRaw = row.get(COL_WP_POST_ID)?.toString().trim();
        if (!postIdRaw || !/^\d+$/.test(postIdRaw)) {
          skipped += 1;
          continue;
        }

        try {
          await this.wordpress.updatePropertyPost(Number(postIdRaw), {
            tipo_inmueble: this.cell(row, COL_TIPO),
            municipio: this.cell(row, COL_MUNICIPIO),
            precio_alquiler: this.cell(row, COL_PRECIO_ALQUILER),
            precio_venta: this.cell(row, COL_PRECIO_VENTA),
            disponibilidad: this.cell(row, COL_DISPONIBILIDAD),
            estado: this.cell(row, COL_ESTADO),
          });
          updated += 1;
        } catch (err) {
          errors += 1;
          this.logger.error(
            `WP update post ${postIdRaw} failed: ${
              err instanceof Error ? err.message : err
            }`,
          );
        }
      }

      this.logger.log(
        `Sheets→WP sync: scanned=${rows.length} updated=${updated} skipped=${skipped} errors=${errors}`,
      );
      return { scanned: rows.length, updated, skipped, errors };
    } finally {
      this.running = false;
    }
  }

  private cell(row: GoogleSpreadsheetRow, col: string): string {
    return row.get(col)?.toString().trim() || '';
  }
}
