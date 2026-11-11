/**
 * Dry-run seguro del backfill Fase 3 (solo lectura).
 * No enrolla, no envía WA/SMS, no quita PAUSE_ALL_AUTOMATIONS.
 *
 * Con túneles Railway (recomendado):
 *   npm run dryrun:backfill-unreached:tunnel
 *
 * Manual:
 *   $env:RAILWAY_PG_TUNNEL_URL="postgresql://...@127.0.0.1:5433/railway"
 *   railway run --service bot-localizer npm run dryrun:backfill-unreached
 */
import 'dotenv/config';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { EnrollmentStatus, PrismaClient } from '@prisma/client';
import { resolveMaxDailyPhase3Leads } from '../src/nurturing/phase3-quota';
import { remainingPhase3DailyQuota } from '../src/nurturing/phase3-quota';
import { PHASE3_BACKFILL_SOURCE } from '../src/nurturing/phase3-quota';
import {
  describePhase3Allowlist,
  isPhase3AllowedPhone,
} from '../src/nurturing/phase3-allowlist';
import { isNurturingPhase3Enabled } from '../src/nurturing/phase3-enabled';
import { isPauseAllAutomations } from '../src/outbound/pause-automations';
import {
  madridDateKey,
  madridStartOfDay,
} from '../src/outbound/outbound-schedule';
import { formatE164Spain, phoneDedupeKey } from '../src/nurturing/utils/phone.util';
import {
  BACKFILL_SHEET_NAME,
  COL_CALL_ID,
  extractBackfillPhoneRaw,
  hasBackfillT0WhatsappRecord,
  isBackfillUnreachedCandidate,
} from '../src/nurturing/sync/backfill-unreached';
import { SheetsService } from '../src/sheets/sheets.service';
import {
  preferReachableRailwayUrls,
  redactUrl,
} from './railway-local-urls';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true })],
  providers: [SheetsService],
})
class DryRunBackfillModule {}

async function main(): Promise<void> {
  const urls = preferReachableRailwayUrls();
  console.log(
    `[dryrun] db=${redactUrl(urls.database)} pause=${process.env.PAUSE_ALL_AUTOMATIONS ?? '(unset)'} allowlist=${describePhase3Allowlist(process.env.NURTURING_PHASE3_PHONE_ALLOWLIST)}`,
  );

  const maxDaily = resolveMaxDailyPhase3Leads(
    process.env.MAX_DAILY_PHASE3_LEADS ??
      process.env.NURTURING_PHASE3_DAILY_QUOTA,
  );
  const phase3On = isNurturingPhase3Enabled(
    process.env.NURTURING_PHASE3_ENABLED,
  );
  const paused = isPauseAllAutomations(process.env.PAUSE_ALL_AUTOMATIONS);

  const prisma = new PrismaClient();
  const app = await NestFactory.createApplicationContext(DryRunBackfillModule, {
    logger: ['error', 'warn'],
  });

  try {
    const usedToday = await prisma.sequenceEnrollment.count({
      where: {
        enrolledAt: { gte: madridStartOfDay() },
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
    const remaining = remainingPhase3DailyQuota({ usedToday, maxDaily });

    const sheets = app.get(SheetsService);
    const { sheet, rows } = await sheets.getAllRows(BACKFILL_SHEET_NAME);
    const headers = sheet.headerValues || [];

    let sheetCandidates = 0;
    let eligible = 0;
    let skippedInvalidPhone = 0;
    let skippedAllowlist = 0;
    let skippedDupPhone = 0;
    let alreadyHasT0Claim = 0;
    let alreadyActiveEnrollment = 0;
    const seenPhones = new Set<string>();
    const sample: Array<{
      rowNumber: number;
      phone: string;
      callId?: string;
      note: string;
    }> = [];

    for (const row of rows) {
      if (!isBackfillUnreachedCandidate(row, headers)) continue;
      sheetCandidates += 1;

      const phoneRaw = extractBackfillPhoneRaw(row);
      if (!phoneRaw) {
        skippedInvalidPhone += 1;
        continue;
      }

      let e164: string;
      let dedupe: string;
      try {
        e164 = formatE164Spain(phoneRaw);
        dedupe = phoneDedupeKey(e164);
      } catch {
        skippedInvalidPhone += 1;
        continue;
      }

      if (seenPhones.has(dedupe)) {
        skippedDupPhone += 1;
        continue;
      }
      seenPhones.add(dedupe);

      if (
        !isPhase3AllowedPhone(
          e164,
          process.env.NURTURING_PHASE3_PHONE_ALLOWLIST,
        )
      ) {
        skippedAllowlist += 1;
        continue;
      }

      const lead =
        (await prisma.lead.findUnique({ where: { phone: e164 } })) ||
        (await prisma.lead.findFirst({
          where: { phone: { contains: e164.replace(/\D/g, '').slice(-9) } },
          orderBy: { updatedAt: 'desc' },
        }));

      const meta = (lead?.metadata as Record<string, unknown> | null) || {};
      const t0Claimed = hasBackfillT0WhatsappRecord(meta);
      const active = lead
        ? await prisma.sequenceEnrollment.findFirst({
            where: { leadId: lead.id, status: EnrollmentStatus.active },
            select: { id: true },
          })
        : null;

      if (active) alreadyActiveEnrollment += 1;
      if (t0Claimed) alreadyHasT0Claim += 1;

      // Elegible para el lote de mañana: allowlist OK y sin enrollment activo.
      // El claim T+0 solo evita reenviar WA; el enroll aún puede ocurrir.
      if (!active) {
        eligible += 1;
        if (sample.length < 20) {
          sample.push({
            rowNumber: row.rowNumber,
            phone: e164,
            callId: String(row.get(COL_CALL_ID) ?? '').trim() || undefined,
            note: t0Claimed ? 'would_enroll_wa_skip_dup' : 'would_enroll',
          });
        }
      }
    }

    const firstBatchSize = Math.min(eligible, remaining);
    const report = {
      ok: true,
      dryRun: true,
      madridDate: madridDateKey(),
      phase3Enabled: phase3On,
      pauseAllAutomations: paused,
      note: paused
        ? 'PAUSE_ALL_AUTOMATIONS=true — el cron de mañana no correrá hasta quitar la pausa; este dry-run es solo lectura.'
        : 'Pausa off — el cron L-V 10:05 podría enrollar hasta firstBatchSize.',
      quota: {
        maxDaily,
        usedToday,
        remaining,
        envMaxDailyPhase3:
          process.env.MAX_DAILY_PHASE3_LEADS ??
          process.env.NURTURING_PHASE3_DAILY_QUOTA ??
          '(default 30)',
        maxDailyCallsFase1: process.env.MAX_DAILY_CALLS ?? '(default 35)',
      },
      sheet: {
        name: BACKFILL_SHEET_NAME,
        scanned: rows.length,
        sheetCandidates,
        eligibleForFirstBatch: eligible,
        firstBatchSize,
        skippedInvalidPhone,
        skippedAllowlist,
        skippedDupPhone,
        alreadyActiveEnrollment,
        alreadyHasT0Claim,
      },
      sample,
    };

    console.log(JSON.stringify(report, null, 2));
  } finally {
    await app.close();
    await prisma.$disconnect();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
