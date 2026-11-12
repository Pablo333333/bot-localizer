/**
 * Reintento acotado WA T+0 para leads con claim failed (hoy).
 * NO toca SequenceEnrollment / BullMQ / cron.
 *
 * Uso (túnel PG + env Railway):
 *   $env:RAILWAY_PG_TUNNEL_URL="postgresql://...@127.0.0.1:5433/railway"
 *   railway run --service bot-localizer npm run retry:backfill-t0 -- --pilot
 *   railway run --service bot-localizer npm run retry:backfill-t0 -- --rest
 *   railway run --service bot-localizer npm run retry:backfill-t0 -- --all-after-pilot
 */
import 'dotenv/config';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { Channel as PrismaChannel, Prisma, PrismaClient } from '@prisma/client';
import { WhatsappChannel } from '../src/nurturing/channels/whatsapp.channel';
import { buildSeguimientoSmsContentVariables } from '../src/nurturing/followup/lead-sms-content-vars';
import { PrismaModule } from '../src/prisma/prisma.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { isPauseAllAutomations } from '../src/outbound/pause-automations';
import {
  BACKFILL_T0_LOG_PREFIX,
  META_BACKFILL_T0_CLAIMED_AT,
  META_BACKFILL_T0_PROVIDER_REF,
  META_BACKFILL_T0_SENT_AT,
  META_BACKFILL_T0_STATUS,
} from '../src/nurturing/sync/backfill-unreached';
import {
  TEMPLATE_WA_T0,
  renderToniNoAnswerFallback,
  resolveToniBookingLink,
  resolveWhatsappSeguimientoContentSid,
} from '../src/nurturing/toni-fase3.constants';
import {
  preferReachableRailwayUrls,
  redactUrl,
} from './railway-local-urls';

const THROTTLE_MS = 2000;

type FailedLead = {
  id: string;
  phone: string;
  name: string | null;
  email: string | null;
  metadata: Prisma.JsonValue | null;
};

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), PrismaModule],
  providers: [WhatsappChannel],
})
class RetryBackfillT0Module {}

function parseArgs(argv: string[]) {
  // npm a veces traga flags --*; aceptar también tokens sin guiones.
  const tokens = argv.map((a) => a.replace(/^--/, '').toLowerCase());
  const pilot = tokens.includes('pilot');
  const rest = tokens.includes('rest');
  const allAfterPilot =
    tokens.includes('all-after-pilot') || tokens.includes('all_after_pilot');
  const limitIdx = tokens.indexOf('limit');
  const limitRaw =
    limitIdx >= 0 ? Number.parseInt(argv[limitIdx + 1] || tokens[limitIdx + 1] || '', 10) : undefined;
  const mode = tokens.find((t) =>
    ['pilot', 'rest', 'all-after-pilot', 'all_after_pilot'].includes(t),
  );
  return {
    pilot: pilot || mode === 'pilot',
    rest: rest || mode === 'rest',
    allAfterPilot:
      allAfterPilot ||
      mode === 'all-after-pilot' ||
      mode === 'all_after_pilot',
    limit: Number.isFinite(limitRaw) ? limitRaw : undefined,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function listFailedToday(prisma: PrismaClient): Promise<FailedLead[]> {
  const rows = await prisma.$queryRaw<
    Array<{
      id: string;
      phone: string;
      name: string | null;
      email: string | null;
      metadata: Prisma.JsonValue | null;
    }>
  >`
    SELECT l.id, l.phone, l.name, l.email, l.metadata
    FROM "Lead" l
    WHERE l.metadata->>'phase3_backfill_t0_status' = 'failed'
      AND (
        (l.metadata->>'phase3_backfill_date') =
          to_char(CURRENT_TIMESTAMP AT TIME ZONE 'Europe/Madrid', 'YYYY-MM-DD')
        OR (
          (l.metadata->>'phase3_backfill_t0_claimed_at') IS NOT NULL
          AND ((l.metadata->>'phase3_backfill_t0_claimed_at')::timestamptz
               AT TIME ZONE 'Europe/Madrid')::date
            = (CURRENT_TIMESTAMP AT TIME ZONE 'Europe/Madrid')::date
        )
      )
    ORDER BY (l.metadata->>'phase3_backfill_t0_claimed_at') ASC NULLS LAST, l.id ASC
  `;
  return rows;
}

/** Quita marcas T+0 y archiva logs — no toca enrollments. */
async function clearT0ClaimForRetry(
  prisma: PrismaService,
  leadId: string,
): Promise<void> {
  const lead = await prisma.lead.findUnique({ where: { id: leadId } });
  if (!lead) return;
  const meta = { ...((lead.metadata as Record<string, unknown> | null) || {}) };
  delete meta[META_BACKFILL_T0_CLAIMED_AT];
  delete meta[META_BACKFILL_T0_SENT_AT];
  delete meta[META_BACKFILL_T0_STATUS];
  delete meta[META_BACKFILL_T0_PROVIDER_REF];
  meta.phase3_backfill_t0_retry_cleared_at = new Date().toISOString();

  await prisma.$transaction([
    prisma.lead.update({
      where: { id: leadId },
      data: { metadata: meta as Prisma.InputJsonValue },
    }),
    prisma.$executeRaw`
      UPDATE "CommunicationLog"
      SET summary = 'backfill_t0_archived:' || COALESCE(split_part(summary, ':', 2), 'unknown')
      WHERE "leadId" = ${leadId}
        AND channel = 'whatsapp'
        AND summary LIKE ${`${BACKFILL_T0_LOG_PREFIX}:%`}
    `,
  ]);
}

async function sendT0Retry(params: {
  prisma: PrismaService;
  whatsapp: WhatsappChannel;
  config: ConfigService;
  lead: FailedLead;
}): Promise<{ ok: boolean; providerRef?: string; error?: string }> {
  const { prisma, whatsapp, config, lead } = params;
  const claimedAt = new Date().toISOString();
  const existing = await prisma.lead.findUnique({ where: { id: lead.id } });
  const meta = {
    ...((existing?.metadata as Record<string, unknown> | null) || {}),
    [META_BACKFILL_T0_CLAIMED_AT]: claimedAt,
    [META_BACKFILL_T0_STATUS]: 'claimed',
    phase3_backfill_t0_retry: true,
  };

  await prisma.$transaction([
    prisma.lead.update({
      where: { id: lead.id },
      data: { metadata: meta as Prisma.InputJsonValue },
    }),
    prisma.communicationLog.create({
      data: {
        leadId: lead.id,
        channel: PrismaChannel.whatsapp,
        direction: 'outbound',
        summary: `${BACKFILL_T0_LOG_PREFIX}:claimed`,
        providerRef: null,
      },
    }),
  ]);

  const bookingLink = resolveToniBookingLink(
    config.get<string>('BOOKING_LINK'),
    config.get<string>('CALENDAR_BOOKING_URL'),
    config.get<string>('BOOKING_LINK_CALL'),
  );
  const waContentSid = resolveWhatsappSeguimientoContentSid({
    envSid: config.get<string>('TWILIO_WHATSAPP_CONTENT_SID'),
  });
  const contentVariables = buildSeguimientoSmsContentVariables(lead);
  const body = renderToniNoAnswerFallback(contentVariables, lead.name);

  const result = await whatsapp.send({
    leadId: lead.id,
    phone: lead.phone,
    name: lead.name,
    email: lead.email,
    templateKey: TEMPLATE_WA_T0,
    templatePayload: {
      body,
      booking_link: bookingLink,
      contentVariables,
      bypassWhatsappGate: true,
      ...(waContentSid ? { contentSid: waContentSid } : {}),
    },
    stepRunId: `backfill-retry:${lead.id}`,
  });

  const now = new Date().toISOString();
  const fresh = await prisma.lead.findUnique({ where: { id: lead.id } });
  const nextMeta = {
    ...((fresh?.metadata as Record<string, unknown> | null) || {}),
  };

  if (!result.success) {
    nextMeta[META_BACKFILL_T0_STATUS] = 'failed';
    await prisma.$transaction([
      prisma.lead.update({
        where: { id: lead.id },
        data: { metadata: nextMeta as Prisma.InputJsonValue },
      }),
      prisma.communicationLog.create({
        data: {
          leadId: lead.id,
          channel: PrismaChannel.whatsapp,
          direction: 'outbound',
          summary: `${BACKFILL_T0_LOG_PREFIX}:failed`,
          providerRef: null,
        },
      }),
    ]);
    return { ok: false, error: result.error || 'twilio_failed' };
  }

  nextMeta[META_BACKFILL_T0_STATUS] = 'sent';
  nextMeta[META_BACKFILL_T0_SENT_AT] = now;
  if (result.providerRef) {
    nextMeta[META_BACKFILL_T0_PROVIDER_REF] = result.providerRef;
  }
  await prisma.$transaction([
    prisma.lead.update({
      where: { id: lead.id },
      data: { metadata: nextMeta as Prisma.InputJsonValue },
    }),
    prisma.communicationLog.create({
      data: {
        leadId: lead.id,
        channel: PrismaChannel.whatsapp,
        direction: 'outbound',
        summary: `${BACKFILL_T0_LOG_PREFIX}:sent`,
        providerRef: result.providerRef ?? null,
      },
    }),
  ]);
  return { ok: true, providerRef: result.providerRef };
}

async function processOne(
  deps: {
    prisma: PrismaService;
    whatsapp: WhatsappChannel;
    config: ConfigService;
  },
  lead: FailedLead,
  index: number,
  total: number,
): Promise<boolean> {
  console.log(
    `[retry] (${index + 1}/${total}) clear+send lead=${lead.id} phone=${lead.phone}`,
  );
  await clearT0ClaimForRetry(deps.prisma, lead.id);
  const outcome = await sendT0Retry({ ...deps, lead });
  if (outcome.ok) {
    console.log(
      `[retry] OK lead=${lead.id} sid=${outcome.providerRef || '?'} — enrollments intactos`,
    );
    return true;
  }
  console.error(
    `[retry] FAIL lead=${lead.id} error=${outcome.error || 'unknown'}`,
  );
  return false;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const urls = preferReachableRailwayUrls();
  console.log(
    `[retry] db=${redactUrl(urls.database)} from=${process.env.TWILIO_WHATSAPP_NUMBER || '(unset)'} pause=${process.env.PAUSE_ALL_AUTOMATIONS}`,
  );

  if (isPauseAllAutomations(process.env.PAUSE_ALL_AUTOMATIONS)) {
    throw new Error(
      'PAUSE_ALL_AUTOMATIONS=true — aborta reintento (quita la pausa en Railway o usa railway run).',
    );
  }

  const app = await NestFactory.createApplicationContext(RetryBackfillT0Module, {
    logger: ['log', 'warn', 'error'],
  });

  try {
    const prisma = app.get(PrismaService);
    const whatsapp = app.get(WhatsappChannel);
    const config = app.get(ConfigService);
    const deps = { prisma, whatsapp, config };

    let failed = await listFailedToday(prisma);
    console.log(`[retry] candidatos failed hoy (Madrid): ${failed.length}`);
    if (failed.length === 0) {
      console.log('[retry] nada que reintentar');
      return;
    }

    if (!args.pilot && !args.rest && !args.allAfterPilot) {
      throw new Error(
        'Indica modo: pilot | rest | all-after-pilot (ej. npm run retry:backfill-t0 -- pilot)',
      );
    }

    if (args.pilot || args.allAfterPilot) {
      const pilot = failed[0];
      const ok = await processOne(deps, pilot, 0, 1);
      if (!ok) {
        console.error(
          '[retry] PILOTO FALLÓ — no se continúa con el resto. Revisa Twilio/Channel.',
        );
        process.exitCode = 2;
        return;
      }
      console.log('[retry] PILOTO OK — Twilio aceptó el envío');
      if (args.pilot && !args.allAfterPilot) {
        return;
      }
      // refrescar lista: el piloto ya no está en failed
      failed = await listFailedToday(prisma);
      console.log(`[retry] restantes failed tras piloto: ${failed.length}`);
    } else if (args.rest) {
      // solo restantes (ya no include enviados)
      failed = await listFailedToday(prisma);
    }

    if (args.pilot && !args.allAfterPilot) {
      return;
    }

    const batch = args.limit != null ? failed.slice(0, args.limit) : failed;
    for (let i = 0; i < batch.length; i++) {
      const ok = await processOne(deps, batch[i], i, batch.length);
      if (!ok) {
        console.error(
          `[retry] parada tras fallo en lead=${batch[i].id} (enviados parciales conservan status=sent)`,
        );
        process.exitCode = 3;
        break;
      }
      if (i < batch.length - 1) {
        await sleep(THROTTLE_MS);
      }
    }

    const stillFailed = await listFailedToday(prisma);
    const sentToday = await prisma.$queryRaw<Array<{ n: number }>>`
      SELECT COUNT(*)::int AS n
      FROM "Lead"
      WHERE metadata->>'phase3_backfill_t0_status' = 'sent'
        AND (
          (metadata->>'phase3_backfill_date') =
            to_char(CURRENT_TIMESTAMP AT TIME ZONE 'Europe/Madrid', 'YYYY-MM-DD')
          OR (metadata->>'phase3_backfill_t0_retry') = 'true'
        )
    `;
    console.log(
      JSON.stringify(
        {
          stillFailedToday: stillFailed.length,
          sentMarkedApprox: sentToday[0]?.n ?? 0,
          note: 'SequenceEnrollment / BullMQ no modificados',
        },
        null,
        2,
      ),
    );
  } finally {
    await app.close();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
