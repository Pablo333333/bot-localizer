/**
 * Auditoría solo lectura: filas Sheet 141–230 (Localizados) + cruce BD.
 * No dispara llamadas ni mensajes.
 *
 *   $env:RAILWAY_PG_TUNNEL_URL="postgresql://...@127.0.0.1:5433/railway"
 *   railway run --service bot-localizer npx ts-node --transpile-only -r tsconfig-paths/register scripts/audit-fase1-rows-141-230.ts
 */
import 'dotenv/config';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { EnrollmentStatus, PrismaClient } from '@prisma/client';
import { alreadyHandledAdReason } from '../src/nurturing/engine/already-handled-ad';
import {
  isBackfillUnreachedCandidate,
  sheetRowHasSuccessfulConversion,
  sheetRowWasCalled,
} from '../src/nurturing/sync/backfill-unreached';
import { sheetRowSaysPropertyUnavailable } from '../src/nurturing/followup/property-unavailable';
import { isAnuncioRevisadoSi } from '../src/nurturing/sync/anuncio-revisado';
import { formatE164Spain } from '../src/nurturing/utils/phone.util';
import { SheetsService } from '../src/sheets/sheets.service';
import { preferReachableRailwayUrls, redactUrl } from './railway-local-urls';

const ROW_MIN = 141;
const ROW_MAX = 230;
const FOCUS = 173;

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true })],
  providers: [SheetsService],
})
class AuditModule {}

function cell(row: { get: (h: string) => unknown }, ...headers: string[]): string {
  for (const h of headers) {
    const v = String(row.get(h) ?? '').trim();
    if (v) return v;
  }
  return '';
}

async function main(): Promise<void> {
  try {
    const urls = preferReachableRailwayUrls();
    console.error(`[audit] db=${redactUrl(urls.database)}`);
  } catch (err) {
    console.error(
      `[audit] DB tunnel opcional: ${err instanceof Error ? err.message : err}`,
    );
  }

  const prisma = new PrismaClient();
  const app = await NestFactory.createApplicationContext(AuditModule, {
    logger: ['error', 'warn'],
  });

  try {
    const sheets = app.get(SheetsService);
    const { sheet, rows } = await sheets.getAllRows('Localizados');
    const headers = sheet.headerValues || [];

    const slice = rows.filter(
      (r) => r.rowNumber >= ROW_MIN && r.rowNumber <= ROW_MAX,
    );

    type RowAudit = {
      rowNumber: number;
      llamado: string;
      callId: string;
      revisado: boolean;
      propietarioContactado: string;
      publicacionAutorizada: string;
      disponibilidad: string;
      wpPostId: string;
      phone: string;
      conversion: boolean;
      alreadyHandled: string | null;
      unavailable: boolean;
      wasCalled: boolean;
      backfillUnreached: boolean;
      fase1WouldDialIfLlamadoEmpty: boolean;
      leadStatus?: string | null;
      activeEnrollment?: boolean;
      nurturingSuppressed?: string | null;
    };

    const audits: RowAudit[] = [];

    for (const row of slice) {
      const phoneRaw =
        cell(row, 'Teléfono contacto1', 'Telefono1', 'Telefono2', 'Telefono3') ||
        '';
      let phone = '';
      try {
        if (phoneRaw) phone = formatE164Spain(phoneRaw);
      } catch {
        phone = phoneRaw;
      }

      const conversion = sheetRowHasSuccessfulConversion(row, headers);
      const handled = alreadyHandledAdReason(row, headers);
      const unavailable = sheetRowSaysPropertyUnavailable(row, headers);
      const revisado = isAnuncioRevisadoSi(row, headers);
      const llamado = cell(row, 'Llamado');
      const callId = cell(row, 'Call ID');
      const llamadoEmpty = !llamado || !/^(SI|SÍ|INTENTADO|YES|TRUE|1)$/i.test(llamado);
      const callIdEmpty = !callId;

      let leadStatus: string | null = null;
      let activeEnrollment = false;
      let nurturingSuppressed: string | null = null;

      if (phone) {
        try {
          const digits = phone.replace(/\D/g, '').slice(-9);
          const lead =
            (await prisma.lead.findUnique({ where: { phone } })) ||
            (await prisma.lead.findFirst({
              where: { phone: { contains: digits } },
              orderBy: { updatedAt: 'desc' },
            }));
          if (lead) {
            leadStatus = lead.status;
            const meta = (lead.metadata as Record<string, unknown> | null) || {};
            nurturingSuppressed = meta.nurturing_suppressed
              ? String(meta.nurturing_suppressed)
              : null;
            const active = await prisma.sequenceEnrollment.findFirst({
              where: { leadId: lead.id, status: EnrollmentStatus.active },
              select: { id: true },
            });
            activeEnrollment = !!active;
          }
        } catch {
          // DB unreachable — sheet-only audit still useful
        }
      }

      audits.push({
        rowNumber: row.rowNumber,
        llamado,
        callId: callId.slice(0, 24),
        revisado,
        propietarioContactado: cell(
          row,
          'Propietario contactado?',
          'Propietario contactado',
        ),
        publicacionAutorizada: cell(
          row,
          'Publicacion Autorizada?',
          'Publicación Autorizada?',
        ),
        disponibilidad: cell(row, 'Disponibilidad', 'Disponibilidad (SI/NO)'),
        wpPostId: cell(row, 'WP Post ID', 'Wp Post ID', 'ID_WP', 'Referencia'),
        phone,
        conversion,
        alreadyHandled: handled,
        unavailable,
        wasCalled: sheetRowWasCalled(row),
        backfillUnreached: isBackfillUnreachedCandidate(row, headers),
        fase1WouldDialIfLlamadoEmpty:
          revisado && llamadoEmpty && callIdEmpty && !conversion && !unavailable,
        leadStatus,
        activeEnrollment,
        nurturingSuppressed,
      });
    }

    const focus = audits.find((a) => a.rowNumber === FOCUS);
    const conversionTrue = audits.filter((a) => a.conversion);
    const conversionFalseLlamadoEmpty = audits.filter(
      (a) =>
        !a.conversion &&
        (!a.llamado || !/^(SI|SÍ|INTENTADO|YES|TRUE|1)$/i.test(a.llamado)),
    );
    const riskRedial =
      audits.filter((a) => {
        const llamadoEmpty =
          !a.llamado || !/^(SI|SÍ|INTENTADO|YES|TRUE|1)$/i.test(a.llamado);
        const callIdEmpty = !a.callId;
        return a.revisado && llamadoEmpty && callIdEmpty && a.conversion;
      });
    const riskRedialNoConversion = audits.filter((a) => {
      const llamadoEmpty =
        !a.llamado || !/^(SI|SÍ|INTENTADO|YES|TRUE|1)$/i.test(a.llamado);
      const callIdEmpty = !a.callId;
      return a.revisado && llamadoEmpty && callIdEmpty && !a.conversion && !a.unavailable;
    });

    console.log(
      JSON.stringify(
        {
          range: `${ROW_MIN}-${ROW_MAX}`,
          scanned: audits.length,
          headersPresent: {
            Llamado: headers.includes('Llamado'),
            CallId: headers.includes('Call ID'),
            Propietario: headers.some((h) => /propietario contactado/i.test(h)),
            Publicacion: headers.some((h) => /publicaci[oó]n autorizada/i.test(h)),
            Disponibilidad: headers.some((h) => /^disponibilidad$/i.test(h.trim())),
          },
          focusRow173: focus ?? null,
          counts: {
            conversionTrue: conversionTrue.length,
            riskRedialIfClearedLlamadoAndCallId: riskRedial.length,
            trulyPendingIfLlamadoAndCallIdEmpty: riskRedialNoConversion.length,
            conversionFalseWithLlamadoEmpty: conversionFalseLlamadoEmpty.length,
            unavailable: audits.filter((a) => a.unavailable).length,
            activeEnrollment: audits.filter((a) => a.activeEnrollment).length,
          },
          riskRedialSample: riskRedial.slice(0, 25),
          trulyPendingSample: riskRedialNoConversion.slice(0, 15),
          focusNeighbors: audits.filter(
            (a) => a.rowNumber >= FOCUS - 2 && a.rowNumber <= FOCUS + 2,
          ),
        },
        null,
        2,
      ),
    );
  } finally {
    await app.close();
    await prisma.$disconnect();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
