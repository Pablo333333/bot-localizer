import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { LeadStatus as PrismaLeadStatus, Prisma } from '@prisma/client';
import { GoogleSpreadsheetRow } from 'google-spreadsheet';
import { PrismaService } from '../../prisma/prisma.service';
import { SheetsService } from '../../sheets/sheets.service';
import { LeadStatus } from '../enums';
import { normalizePhone, phoneDedupeKey } from '../utils/phone.util';
import { buildLeadPropertyMetadataFromSheet } from '../followup/lead-sms-content-vars';

const SHEET_NAME = 'Localizados';
const COL_ESTADO = 'Estado';
const COL_TEL_CONTACTO1 = 'Teléfono contacto1';
const COL_NOMBRE_CONTACTO1 = 'Nombre contacto1';
const COL_TELEFONO1 = 'Telefono1';
const COL_TELEFONO2 = 'Telefono2';
const COL_TELEFONO3 = 'Telefono3';
const COL_EMAIL_PROPIETARIO = 'Email propietario-gestor';
const COL_EMAIL_AVISOS = 'Email Avisos';
const COL_LLAMADO_POR = 'Llamado por';

type LeadIndexRow = {
  id: string;
  phone: string;
  email: string | null;
  name: string | null;
  source: string | null;
  status: PrismaLeadStatus;
  metadata: Prisma.JsonValue;
};

@Injectable()
export class SheetsLeadSyncService {
  private readonly logger = new Logger(SheetsLeadSyncService.name);
  private ingestRunning = false;

  constructor(
    private readonly sheetsService: SheetsService,
    private readonly prisma: PrismaService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async scheduledIngest(): Promise<void> {
    try {
      await this.ingestFromSheets();
    } catch (error) {
      this.logger.error(
        `Scheduled Sheets ingest failed: ${
          error instanceof Error ? error.message : error
        }`,
      );
    }
  }

  async ingestFromSheets(): Promise<{
    imported: number;
    updated: number;
    skipped: number;
    totalRows: number;
  }> {
    if (this.ingestRunning) {
      this.logger.warn('Sheets ingest already running — skipped');
      return { imported: 0, updated: 0, skipped: 0, totalRows: 0 };
    }

    this.ingestRunning = true;
    let imported = 0;
    let updated = 0;
    let skipped = 0;

    try {
      const { sheet, rows } = await this.sheetsService.getAllRows(SHEET_NAME);

      const existingLeads = await this.prisma.lead.findMany({
        select: {
          id: true,
          phone: true,
          email: true,
          name: true,
          source: true,
          status: true,
          metadata: true,
        },
      });
      const byDigits = new Map<string, LeadIndexRow>();
      for (const lead of existingLeads) {
        try {
          byDigits.set(phoneDedupeKey(lead.phone), lead);
        } catch {
          /* ignore malformed */
        }
      }

      const seenInSheet = new Set<string>();

      for (const row of rows) {
        const phoneRaw = this.extractPhone(row);
        if (!phoneRaw) {
          skipped += 1;
          continue;
        }

        let phone: string;
        let dedupeKey: string;
        try {
          phone = normalizePhone(phoneRaw);
          dedupeKey = phoneDedupeKey(phone);
        } catch {
          skipped += 1;
          continue;
        }

        if (seenInSheet.has(dedupeKey)) {
          skipped += 1;
          continue;
        }
        seenInSheet.add(dedupeKey);

        const sheetsRowNumber = row.rowNumber;
        const name = this.firstNonEmpty(row.get(COL_NOMBRE_CONTACTO1));
        const email = this.firstNonEmpty(
          row.get(COL_EMAIL_AVISOS),
          row.get(COL_EMAIL_PROPIETARIO),
        );
        const mappedStatus = this.mapSheetEstadoToLeadStatus(
          row.get(COL_ESTADO)?.toString() || '',
        );
        const metadata: Record<string, unknown> = {
          ...buildLeadPropertyMetadataFromSheet((h) => row.get(h)),
          llamado_por: row.get(COL_LLAMADO_POR)?.toString()?.trim() || undefined,
        };

        const existing = byDigits.get(dedupeKey);

        if (!existing) {
          const created = await this.prisma.lead.create({
            data: {
              phone,
              email: email || null,
              name: name || null,
              source: 'sheets_sync',
              status: mappedStatus,
              sheetsRowNumber,
              metadata: metadata as Prisma.InputJsonValue,
              statusChangedAt: new Date(),
            },
          });
          byDigits.set(dedupeKey, {
            id: created.id,
            phone: created.phone,
            email: created.email,
            name: created.name,
            source: created.source,
            status: created.status,
            metadata: created.metadata,
          });
          imported += 1;
          continue;
        }

        const shouldAdoptSheetStatus =
          existing.status === PrismaLeadStatus.nuevo &&
          mappedStatus !== PrismaLeadStatus.nuevo;

        await this.prisma.lead.update({
          where: { id: existing.id },
          data: {
            phone,
            email: email || existing.email,
            name: name || existing.name,
            sheetsRowNumber,
            source: existing.source || 'sheets_sync',
            metadata: {
              ...((existing.metadata as object) || {}),
              ...metadata,
            } as Prisma.InputJsonValue,
            ...(shouldAdoptSheetStatus
              ? { status: mappedStatus, statusChangedAt: new Date() }
              : {}),
          },
        });
        updated += 1;
      }

      this.logger.log(
        `Sheets ingest done: imported=${imported} updated=${updated} skipped=${skipped} total=${rows.length}`,
      );

      return { imported, updated, skipped, totalRows: rows.length };
    } finally {
      this.ingestRunning = false;
    }
  }

  async syncStatusToSheets(
    phone: string,
    status: string,
    sheetsRowNumber?: number | null,
  ): Promise<void> {
    const { sheet, rows } = await this.sheetsService.getAllRows(SHEET_NAME);
    const headers = new Set(sheet.headerValues || []);
    if (!headers.has(COL_ESTADO) && !headers.has('Ilocalizable')) {
      this.logger.warn(
        `Columnas "${COL_ESTADO}" / Ilocalizable no encontradas — skip status sync`,
      );
      return;
    }

    let row: GoogleSpreadsheetRow | undefined;

    if (sheetsRowNumber != null) {
      row = rows.find((r) => r.rowNumber === sheetsRowNumber);
    }

    if (!row) {
      const targetKey = phoneDedupeKey(phone);
      row = rows.find((r) => {
        const candidates = [
          r.get(COL_TEL_CONTACTO1),
          r.get(COL_TELEFONO1),
          r.get(COL_TELEFONO2),
          r.get(COL_TELEFONO3),
        ];
        return candidates.some((c) => {
          if (!c) return false;
          try {
            return phoneDedupeKey(String(c)) === targetKey;
          } catch {
            return false;
          }
        });
      });
    }

    if (!row) {
      this.logger.warn(
        `No Sheets row found for phone=${phone} row=${sheetsRowNumber} — status not synced`,
      );
      return;
    }

    await this.sheetsService.updateTrackingCells(
      sheet,
      row.rowNumber,
      {
        // No sobrescribir "Estado" (condición del inmueble) con pipeline de lead.
        // Solo marcar Ilocalizable cuando aplica.
        Ilocalizable: status === 'ilocalizable' ? 'SI' : undefined,
        ...(headers.has('Estado lead')
          ? { 'Estado lead': status }
          : headers.has('Estado nurturing')
            ? { 'Estado nurturing': status }
            : {}),
      },
      row,
    );
    this.logger.log(
      `Synced status "${status}" → Sheets row ${row.rowNumber} (phone=${phone})`,
    );
  }

  private getLocalizadosSheet() {
    const doc = this.sheetsService.getDoc();
    const sheet = doc.sheetsByTitle[SHEET_NAME] || doc.sheetsByIndex[0];
    if (!sheet) {
      throw new Error(`Sheet "${SHEET_NAME}" not found`);
    }
    return sheet;
  }

  private extractPhone(row: GoogleSpreadsheetRow): string | null {
    const candidates = [
      row.get(COL_TEL_CONTACTO1),
      row.get(COL_TELEFONO1),
      row.get(COL_TELEFONO2),
      row.get(COL_TELEFONO3),
    ];
    for (const c of candidates) {
      const value = c?.toString().trim();
      if (value) return value;
    }
    return null;
  }

  private firstNonEmpty(
    ...values: Array<string | number | boolean | null | undefined>
  ): string | null {
    for (const v of values) {
      if (v == null) continue;
      const s = String(v).trim();
      if (s) return s;
    }
    return null;
  }

  mapSheetEstadoToLeadStatus(raw: string): PrismaLeadStatus {
    const s = raw.toLowerCase().trim();
    if (!s) return PrismaLeadStatus.nuevo;

    if (Object.values(LeadStatus).includes(s as LeadStatus)) {
      return s as PrismaLeadStatus;
    }

    if (
      s.includes('visita') ||
      s.includes('cita') ||
      s.includes('agend') ||
      s === 'cita_agendada' ||
      s === 'cita_programada' ||
      s === 'visita_programada' // legacy alias
    ) {
      return PrismaLeadStatus.cita_programada;
    }
    if (s.includes('ilocaliz')) {
      return PrismaLeadStatus.ilocalizable;
    }
    if (
      s.includes('pendiente') ||
      s.includes('no contesta') ||
      s.includes('no_answer') ||
      s.includes('hangup') ||
      s.includes('reintento')
    ) {
      return PrismaLeadStatus.pendiente;
    }
    if (
      s.includes('cerrad') ||
      s.includes('no interesa') ||
      s.includes('descart')
    ) {
      return PrismaLeadStatus.cerrado;
    }
    if (s.includes('interes')) {
      return PrismaLeadStatus.interesado;
    }

    return PrismaLeadStatus.nuevo;
  }
}
