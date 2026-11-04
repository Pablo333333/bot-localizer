import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import {
  EnrollmentStatus,
  LeadStatus as PrismaLeadStatus,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SheetsService } from '../../sheets/sheets.service';
import type { IsolatedSheetRow } from '../../sheets/sheet-row-isolation';
import {
  OUTBOUND_HOURS_DESCRIPTION,
  isWithinOutboundCallHours,
  madridDateKey,
  madridOutboundParts,
  madridStartOfDay,
} from '../../outbound/outbound-schedule';
import { buildLeadPropertyMetadataFromSheet } from '../followup/lead-sms-content-vars';
import { EnrollmentsService } from '../enrollments/enrollments.service';
import { WhatsappChannel } from '../channels/whatsapp.channel';
import {
  NURTURING_PHASE3_DISABLED_LOG,
  isNurturingPhase3Enabled,
} from '../phase3-enabled';
import {
  PAUSE_ALL_AUTOMATIONS_LOG,
  isPauseAllAutomations,
} from '../../outbound/pause-automations';
import {
  PHASE3_LEAD_NOT_ALLOWED_LOG,
  isPhase3AllowedPhone,
} from '../phase3-allowlist';
import { TERMINAL_LEAD_STATUSES, LeadStatus as AppLeadStatus } from '../enums';
import {
  PHASE3_BACKFILL_SOURCE,
  remainingPhase3DailyQuota,
  resolveMaxDailyPhase3Leads,
} from '../phase3-quota';
import {
  TEMPLATE_WA_T0,
  TONI_BOOKING_LINK,
  resolveWhatsappSeguimientoContentSid,
  renderToniNoAnswerFallback,
} from '../toni-fase3.constants';
import { buildSeguimientoSmsContentVariables } from '../followup/lead-sms-content-vars';
import { formatE164Spain, phoneDedupeKey } from '../utils/phone.util';
import {
  BACKFILL_SHEET_NAME,
  COL_CALL_ID,
  COL_NOMBRE_CONTACTO1,
  extractBackfillPhoneRaw,
  isBackfillUnreachedCandidate,
} from './backfill-unreached';

export type BackfillUnreachedOptions = {
  /** Solo escanea y reporta; no enrolla ni envía mensajes. */
  dryRun?: boolean;
  /** Tope adicional sobre el cupo restante (p.ej. pruebas). */
  limit?: number;
  /** Enviar WA T+0 al enrolar (default true si hay cupo y horario). Sin fallback SMS. */
  sendMessages?: boolean;
};

export type BackfillUnreachedResult = {
  ok: boolean;
  dryRun: boolean;
  phase3Enabled: boolean;
  madridDate: string;
  withinBusinessHours: boolean;
  businessHours: string;
  quota: {
    maxDaily: number;
    usedToday: number;
    remaining: number;
  };
  scanned: number;
  candidates: number;
  enrolled: number;
  alreadyActive: number;
  skippedTerminal: number;
  skippedAllowlist: number;
  skippedInvalidPhone: number;
  skippedQuota: number;
  whatsappSent: number;
  smsSent: number;
  errors: number;
  sample?: Array<{
    rowNumber: number;
    phone: string;
    callId?: string;
    action: string;
  }>;
  error?: string;
};

@Injectable()
export class SheetsBackfillUnreachedService {
  private readonly logger = new Logger(SheetsBackfillUnreachedService.name);
  private running = false;

  constructor(
    private readonly sheets: SheetsService,
    private readonly prisma: PrismaService,
    private readonly enrollments: EnrollmentsService,
    private readonly whatsapp: WhatsappChannel,
    private readonly config: ConfigService,
  ) {}

  /**
   * Cron L-V a las 10:05 Madrid: absorbe hasta 30 leads/día no contactados.
   * Independiente del cupo Fase 1 (MAX_DAILY_CALLS).
   */
  @Cron('5 10 * * 1-5', { timeZone: 'Europe/Madrid' })
  async scheduledBackfill(): Promise<void> {
    if (isPauseAllAutomations(this.config.get('PAUSE_ALL_AUTOMATIONS'))) {
      this.logger.warn(PAUSE_ALL_AUTOMATIONS_LOG);
      return;
    }
    try {
      const result = await this.backfillUnreached();
      this.logger.log(
        `[FASE3][BACKFILL] cron done enrolled=${result.enrolled} candidates=${result.candidates} remainingQuota=${result.quota.remaining} errors=${result.errors}`,
      );
    } catch (err) {
      this.logger.error(
        `[FASE3][BACKFILL] cron falló: ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  async backfillUnreached(
    options: BackfillUnreachedOptions = {},
  ): Promise<BackfillUnreachedResult> {
    const dryRun = options.dryRun === true;
    const sendMessages = options.sendMessages !== false;
    const maxDaily = resolveMaxDailyPhase3Leads(
      this.config.get('MAX_DAILY_PHASE3_LEADS') ??
        this.config.get('NURTURING_PHASE3_DAILY_QUOTA'),
    );
    const madridDate = madridDateKey();
    const withinHours = isWithinOutboundCallHours(madridOutboundParts(new Date()));

    const base: BackfillUnreachedResult = {
      ok: true,
      dryRun,
      phase3Enabled: isNurturingPhase3Enabled(
        this.config.get('NURTURING_PHASE3_ENABLED'),
      ),
      madridDate,
      withinBusinessHours: withinHours,
      businessHours: OUTBOUND_HOURS_DESCRIPTION,
      quota: { maxDaily, usedToday: 0, remaining: maxDaily },
      scanned: 0,
      candidates: 0,
      enrolled: 0,
      alreadyActive: 0,
      skippedTerminal: 0,
      skippedAllowlist: 0,
      skippedInvalidPhone: 0,
      skippedQuota: 0,
      whatsappSent: 0,
      smsSent: 0,
      errors: 0,
      sample: [],
    };

    if (!base.phase3Enabled) {
      base.ok = false;
      base.error = NURTURING_PHASE3_DISABLED_LOG;
      this.logger.log(NURTURING_PHASE3_DISABLED_LOG);
      return base;
    }

    if (isPauseAllAutomations(this.config.get('PAUSE_ALL_AUTOMATIONS'))) {
      base.ok = false;
      base.error = PAUSE_ALL_AUTOMATIONS_LOG;
      this.logger.warn(PAUSE_ALL_AUTOMATIONS_LOG);
      return base;
    }

    if (this.running) {
      return {
        ...base,
        ok: false,
        error: 'Backfill already running',
      };
    }

    this.running = true;
    try {
      const usedToday = await this.countBackfillEnrollmentsToday();
      const remaining = remainingPhase3DailyQuota({ usedToday, maxDaily });
      base.quota = { maxDaily, usedToday, remaining };

      const { sheet, rows } = await this.sheets.getAllRows(BACKFILL_SHEET_NAME);
      const headers = sheet.headerValues || [];
      base.scanned = rows.length;

      const candidates: IsolatedSheetRow[] = [];
      for (const row of rows) {
        if (isBackfillUnreachedCandidate(row, headers)) {
          candidates.push(row);
        }
      }
      base.candidates = candidates.length;

      let slots = remaining;
      if (
        options.limit != null &&
        Number.isFinite(options.limit) &&
        options.limit >= 0
      ) {
        slots = Math.min(slots, Math.floor(options.limit));
      }

      if (slots <= 0 && !dryRun) {
        this.logger.log(
          `[FASE3][BACKFILL] cupo diario agotado ${usedToday}/${maxDaily} — no se enrollan más hoy`,
        );
        return base;
      }

      const seenPhones = new Set<string>();

      for (const row of candidates) {
        // Cupo estricto: enrolled + usedToday nunca supera maxDaily (default 30).
        if (!dryRun && base.enrolled >= slots) {
          base.skippedQuota += 1;
          continue;
        }
        if (!dryRun && usedToday + base.enrolled >= maxDaily) {
          base.skippedQuota += 1;
          continue;
        }

        const phoneRaw = extractBackfillPhoneRaw(row);
        if (!phoneRaw) {
          base.skippedInvalidPhone += 1;
          continue;
        }

        let e164: string;
        let dedupe: string;
        try {
          e164 = formatE164Spain(phoneRaw);
          dedupe = phoneDedupeKey(e164);
        } catch {
          base.skippedInvalidPhone += 1;
          continue;
        }

        if (seenPhones.has(dedupe)) {
          base.skippedInvalidPhone += 1;
          continue;
        }
        seenPhones.add(dedupe);

        if (
          !isPhase3AllowedPhone(
            e164,
            this.config.get('NURTURING_PHASE3_PHONE_ALLOWLIST'),
          )
        ) {
          base.skippedAllowlist += 1;
          continue;
        }

        if (dryRun) {
          if ((base.sample?.length ?? 0) < 25) {
            base.sample?.push({
              rowNumber: row.rowNumber,
              phone: e164,
              callId: String(row.get(COL_CALL_ID) ?? '').trim() || undefined,
              action: 'would_enroll',
            });
          }
          continue;
        }

        try {
          const outcome = await this.processCandidateRow({
            row,
            e164,
            sendMessages: sendMessages && withinHours,
          });
          if (outcome.action === 'enrolled') {
            base.enrolled += 1;
            if (outcome.whatsappSent) base.whatsappSent += 1;
          } else if (outcome.action === 'already_active') {
            base.alreadyActive += 1;
          } else if (outcome.action === 'terminal') {
            base.skippedTerminal += 1;
          }
          base.sample?.push({
            rowNumber: row.rowNumber,
            phone: e164,
            callId: String(row.get(COL_CALL_ID) ?? '').trim() || undefined,
            action: outcome.action,
          });
        } catch (err) {
          base.errors += 1;
          const message = err instanceof Error ? err.message : String(err);
          this.logger.warn(
            `[FASE3][BACKFILL] fila ${row.rowNumber} phone=${e164} error (lote continúa): ${message}`,
          );
          base.sample?.push({
            rowNumber: row.rowNumber,
            phone: e164,
            action: `error:${message.slice(0, 120)}`,
          });
        }

        if (base.sample && base.sample.length > 40) {
          base.sample = base.sample.slice(0, 40);
        }
      }

      if (dryRun) {
        base.sample = (base.sample || []).slice(0, 25);
      }

      base.quota.usedToday = usedToday + base.enrolled;
      base.quota.remaining = remainingPhase3DailyQuota({
        usedToday: base.quota.usedToday,
        maxDaily,
      });

      this.logger.log(
        `[FASE3][BACKFILL] scanned=${base.scanned} candidates=${base.candidates} enrolled=${base.enrolled} alreadyActive=${base.alreadyActive} quota=${base.quota.usedToday}/${maxDaily} errors=${base.errors} hours=${withinHours} (${OUTBOUND_HOURS_DESCRIPTION})`,
      );
      return base;
    } finally {
      this.running = false;
    }
  }

  private async countBackfillEnrollmentsToday(): Promise<number> {
    const start = madridStartOfDay();
    return this.prisma.sequenceEnrollment.count({
      where: {
        enrolledAt: { gte: start },
        lead: {
          OR: [
            { source: PHASE3_BACKFILL_SOURCE },
            {
              metadata: {
                path: ['phase3_backfill'],
                equals: true,
              },
            },
          ],
        },
      },
    });
  }

  private async processCandidateRow(params: {
    row: IsolatedSheetRow;
    e164: string;
    sendMessages: boolean;
  }): Promise<{
    action: string;
    whatsappSent?: boolean;
  }> {
    const { row, e164, sendMessages } = params;
    const digits = e164.replace(/\D/g, '').slice(-9);

    let lead =
      (await this.prisma.lead.findUnique({ where: { phone: e164 } })) ||
      (await this.prisma.lead.findFirst({
        where: { phone: { contains: digits } },
        orderBy: { updatedAt: 'desc' },
      }));

    const name =
      String(row.get(COL_NOMBRE_CONTACTO1) ?? '').trim() || null;
    const callId = String(row.get(COL_CALL_ID) ?? '').trim() || null;
    const propertyMeta = buildLeadPropertyMetadataFromSheet((h) => row.get(h));
    const metaPatch: Record<string, unknown> = {
      ...propertyMeta,
      phase3_backfill: true,
      phase3_backfill_date: madridDateKey(),
      phase3_backfill_row: row.rowNumber,
      ...(callId ? { last_call_id: callId } : {}),
    };

    if (!lead) {
      lead = await this.prisma.lead.create({
        data: {
          phone: e164,
          name,
          source: PHASE3_BACKFILL_SOURCE,
          status: PrismaLeadStatus.pendiente,
          sheetsRowNumber: row.rowNumber,
          externalRef: callId,
          metadata: metaPatch as Prisma.InputJsonValue,
          statusChangedAt: new Date(),
        },
      });
    } else {
      if (TERMINAL_LEAD_STATUSES.has(lead.status as AppLeadStatus)) {
        return { action: 'terminal' };
      }
      const existingMeta =
        (lead.metadata as Record<string, unknown> | null) || {};
      lead = await this.prisma.lead.update({
        where: { id: lead.id },
        data: {
          phone: e164,
          name: name || lead.name,
          sheetsRowNumber: row.rowNumber,
          source: lead.source || PHASE3_BACKFILL_SOURCE,
          externalRef: callId || lead.externalRef,
          metadata: {
            ...existingMeta,
            ...metaPatch,
          } as Prisma.InputJsonValue,
          ...(lead.status === PrismaLeadStatus.nuevo
            ? {
                status: PrismaLeadStatus.pendiente,
                statusChangedAt: new Date(),
              }
            : {}),
        },
      });
    }

    const active = await this.prisma.sequenceEnrollment.findFirst({
      where: { leadId: lead.id, status: EnrollmentStatus.active },
    });
    if (active) {
      return { action: 'already_active' };
    }

    let whatsappSent = false;
    if (sendMessages) {
      try {
        whatsappSent = await this.sendT0Whatsapp(lead);
      } catch (err) {
        this.logger.warn(
          `[FASE3][BACKFILL] WA falló lead=${lead.id} (se continúa con enroll): ${
            err instanceof Error ? err.message : err
          }`,
        );
      }
    } else if (!isWithinOutboundCallHours(madridOutboundParts(new Date()))) {
      this.logger.log(
        `[FASE3][BACKFILL] fuera de horario — se omite WA inmediato lead=${lead.id}; pasos BullMQ alineados a ${OUTBOUND_HOURS_DESCRIPTION}`,
      );
    }

    try {
      // SequenceScheduler alinea T+7/T+10 a L-V 10:00-14:00 / 17:00-20:30 Madrid.
      await this.enrollments.enrollLead(lead.id);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes(PHASE3_LEAD_NOT_ALLOWED_LOG)) {
        return { action: 'allowlist' };
      }
      throw err;
    }

    return { action: 'enrolled', whatsappSent };
  }

  /** Solo WhatsApp T+0. Sin fallback SMS ni reintento a otro canal/número. */
  private async sendT0Whatsapp(lead: {
    id: string;
    phone: string;
    name: string | null;
    email: string | null;
    metadata?: unknown;
  }): Promise<boolean> {
    const bookingLink =
      this.config.get<string>('BOOKING_LINK_CALL') || TONI_BOOKING_LINK;
    const waContentSid = resolveWhatsappSeguimientoContentSid({
      envSid: this.config.get<string>('TWILIO_WHATSAPP_CONTENT_SID'),
    });
    const contentVariables = buildSeguimientoSmsContentVariables(lead);
    const waPayload: Record<string, unknown> = {
      body: renderToniNoAnswerFallback(contentVariables, lead.name),
      booking_link: bookingLink,
      contentVariables,
      bypassWhatsappGate: true,
      ...(waContentSid ? { contentSid: waContentSid } : {}),
    };

    try {
      const wa = await this.whatsapp.send({
        leadId: lead.id,
        phone: lead.phone,
        name: lead.name,
        email: lead.email,
        templateKey: TEMPLATE_WA_T0,
        templatePayload: waPayload,
        stepRunId: `backfill:${lead.id}`,
      });
      if (!wa.success) {
        this.logger.warn(
          `[FASE3][BACKFILL] WhatsApp falló lead=${lead.id}: ${wa.error} — se aborta mensajería (sin SMS)`,
        );
        return false;
      }
      return true;
    } catch (err) {
      this.logger.warn(
        `[FASE3][BACKFILL] WhatsApp excepción lead=${lead.id}: ${
          err instanceof Error ? err.message : err
        } — se aborta mensajería (sin SMS)`,
      );
      return false;
    }
  }
}
