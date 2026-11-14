/**
 * Dry-run Fase 1 blindaje + recuperación 141–230.
 * No dispara Retell. Verifica que fila 173 quede descartada.
 *
 *   $env:RAILWAY_PG_TUNNEL_URL="postgresql://...@127.0.0.1:5433/railway"
 *   railway run --service bot-localizer npm run dryrun:fase1-recover
 */
import 'dotenv/config';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { EnrollmentStatus, PrismaClient } from '@prisma/client';
import {
  findAnuncioRevisadoHeader,
  isAnuncioRevisadoSi,
  readAnuncioRevisadoRaw,
} from '../src/nurturing/sync/anuncio-revisado';
import { formatE164Spain } from '../src/nurturing/utils/phone.util';
import {
  FASE1_ENROLLMENT_BLOCK_STATUSES,
  FASE1_MARKED_LLAMADO,
  fase1LeadHardBlockReason,
  fase1SheetHardBlockReason,
  isLlamadoClearedForRetry,
  shouldBlockOnExistingCallId,
} from '../src/outbound/outbound-fase1-guard';
import {
  isWithinCallCooldown,
  latestAttemptTimestamp,
} from '../src/outbound/outbound-call-cooldown';
import { SheetsService } from '../src/sheets/sheets.service';
import { preferReachableRailwayUrls, redactUrl } from './railway-local-urls';

const ROW_MIN = 141;
const ROW_MAX = 230;
const FOCUS = 173;

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true })],
  providers: [SheetsService],
})
class DryRunModule {}

function parseFlexibleDateTime(raw: string): number | null {
  const text = String(raw || '').trim();
  if (!text) return null;
  const dmY = text.match(
    /^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/,
  );
  if (dmY) {
    let y = Number(dmY[3]);
    if (y < 100) y += 2000;
    const d = new Date(
      y,
      Number(dmY[2]) - 1,
      Number(dmY[1]),
      Number(dmY[4] || 0),
      Number(dmY[5] || 0),
      Number(dmY[6] || 0),
    );
    return Number.isNaN(d.getTime()) ? null : d.getTime();
  }
  const t = Date.parse(text);
  return Number.isNaN(t) ? null : t;
}

async function main(): Promise<void> {
  const urls = preferReachableRailwayUrls();
  console.error(`[dryrun-fase1] db=${redactUrl(urls.database)}`);

  const prisma = new PrismaClient();
  const app = await NestFactory.createApplicationContext(DryRunModule, {
    logger: ['error', 'warn'],
  });

  try {
    const sheets = app.get(SheetsService);
    const { sheet, rows } = await sheets.getAllRows('Localizados');
    const headers = sheet.headerValues || [];
    const reviewHeader = findAnuncioRevisadoHeader(headers);

    const slice = rows.filter(
      (r) => r.rowNumber >= ROW_MIN && r.rowNumber <= ROW_MAX,
    );

    const recoverable: Array<{
      rowNumber: number;
      phone: string;
      callId: string;
      reason: 'recoverable';
    }> = [];
    const discarded: Array<{ rowNumber: number; reason: string }> = [];
    let focus173: { rowNumber: number; reason: string } | null = null;

    for (const row of slice) {
      const rowNumber = row.rowNumber;
      let reason: string | null = null;

      if (!isAnuncioRevisadoSi(row, headers)) {
        const raw = readAnuncioRevisadoRaw(row, headers);
        reason = `Anuncio Revisado? no es SI ("${String(raw).trim() || 'vacío'}")`;
      }

      if (!reason) {
        reason = fase1SheetHardBlockReason(row, headers);
      }

      const llamadoRaw = String(row.get('Llamado') ?? '').trim();
      const callId = String(row.get('Call ID') ?? '').trim();

      if (!reason && FASE1_MARKED_LLAMADO.has(llamadoRaw.toUpperCase())) {
        reason = `Llamado ya marcado ("${llamadoRaw}")`;
      }

      if (
        !reason &&
        shouldBlockOnExistingCallId({ llamadoRaw, callId })
      ) {
        reason = `Call ID ya presente ("${callId}")`;
      }

      const attemptTs = latestAttemptTimestamp([
        parseFlexibleDateTime(
          String(row.get('Fecha actualizacion') ?? '').trim(),
        ),
        parseFlexibleDateTime(String(row.get('Fecha Llamada') ?? '').trim()),
        parseFlexibleDateTime(String(row.get('Fecha llamada') ?? '').trim()),
      ]);

      if (!reason && attemptTs !== null && isWithinCallCooldown(attemptTs)) {
        const recoveryRetry =
          isLlamadoClearedForRetry(llamadoRaw) && Boolean(callId);
        if (!recoveryRetry) {
          reason = `Cooldown 48h (${new Date(attemptTs).toISOString()})`;
        }
      }

      let phone = '';
      if (!reason) {
        const phoneRaw =
          String(row.get('Telefono1') ?? '').trim() ||
          String(row.get('Teléfono contacto1') ?? '').trim() ||
          String(row.get('Telefono2') ?? '').trim();
        if (!phoneRaw) {
          reason = 'Sin teléfono válido';
        } else {
          try {
            phone = formatE164Spain(phoneRaw);
          } catch {
            reason = `Teléfono inválido (${phoneRaw})`;
          }
        }
      }

      if (!reason && phone) {
        const digits = phone.replace(/\D/g, '').slice(-9);
        const lead =
          (await prisma.lead.findUnique({ where: { phone } })) ||
          (await prisma.lead.findFirst({
            where: { phone: { contains: digits } },
            orderBy: { updatedAt: 'desc' },
          }));
        if (lead) {
          const enrollment = await prisma.sequenceEnrollment.findFirst({
            where: {
              leadId: lead.id,
              status: { in: FASE1_ENROLLMENT_BLOCK_STATUSES },
            },
            select: { id: true },
          });
          reason = fase1LeadHardBlockReason({
            status: lead.status,
            metadata: (lead.metadata as Record<string, unknown> | null) || {},
            hasActiveOrCompletedEnrollment: !!enrollment,
          });
        }
      }

      if (reason) {
        discarded.push({ rowNumber, reason });
        if (rowNumber === FOCUS) focus173 = { rowNumber, reason };
      } else {
        recoverable.push({
          rowNumber,
          phone,
          callId: callId.slice(0, 28),
          reason: 'recoverable',
        });
        if (rowNumber === FOCUS) {
          focus173 = {
            rowNumber,
            reason: 'ERROR: fila 173 entró como recuperable',
          };
        }
      }
    }

    const byReason: Record<string, number> = {};
    for (const d of discarded) {
      const key = d.reason.split('(')[0].trim();
      byReason[key] = (byReason[key] || 0) + 1;
    }

    console.log(
      JSON.stringify(
        {
          dryRun: true,
          range: `${ROW_MIN}-${ROW_MAX}`,
          scanned: slice.length,
          reviewHeader: reviewHeader || null,
          recoverableCount: recoverable.length,
          discardedCount: discarded.length,
          focusRow173: focus173,
          focus173DiscardedOk:
            focus173 != null &&
            !focus173.reason.startsWith('ERROR') &&
            focus173.reason.length > 0,
          discardReasons: byReason,
          recoverableSample: recoverable.slice(0, 40),
          note: 'Call ID histórico + Llamado vacío permitido si pasa blindaje conversión/disponibilidad/BD',
        },
        null,
        2,
      ),
    );

    if (
      !focus173 ||
      focus173.reason.startsWith('ERROR') ||
      focus173.reason.includes('recuperable')
    ) {
      process.exitCode = 2;
    }
  } finally {
    await app.close();
    await prisma.$disconnect();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
