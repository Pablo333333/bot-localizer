/**
 * Auditoría: ¿hay leads / jobs listos para Fase 3 ahora?
 *
 * Desde el PC (Postgres/Redis internos de Railway):
 *   npm run audit:fase3-ready:tunnel
 *
 * O con túneles ya abiertos:
 *   $env:RAILWAY_PG_TUNNEL_URL="postgresql://...@127.0.0.1:5433/railway"
 *   $env:RAILWAY_REDIS_TUNNEL_URL="redis://...@127.0.0.1:6380"
 *   railway run --service bot-localizer npm run audit:fase3-ready -- --json
 *
 * No uses `cross-env DATABASE_URL=$DATABASE_PUBLIC_URL` en PowerShell:
 * `$DATABASE_PUBLIC_URL` se expande vacío en local (y ese var no existe en el proyecto).
 */
import 'dotenv/config';
import {
  EnrollmentStatus,
  LeadStatus,
  PrismaClient,
  StepRunStatus,
} from '@prisma/client';
import { Queue } from 'bullmq';
import {
  PHASE3_TONI_PHONE_E164,
  resolvePhase3PhoneAllowlist,
} from '../src/nurturing/phase3-allowlist';
import { isNurturingPhase3Enabled } from '../src/nurturing/phase3-enabled';
import { matchesOutboundTestPhone } from '../src/outbound/outbound-test-phone';
import {
  TEMPLATE_CALL_FOLLOWUP_D10,
  TEMPLATE_CALL_FOLLOWUP_D7,
} from '../src/nurturing/toni-fase3.constants';
import {
  preferReachableRailwayUrls,
  redactUrl,
} from './railway-local-urls';

const QUEUE = 'nurturing-steps';
const asJson = process.argv.includes('--json');

function inAllowlist(phone: string, allowlist: string[]): boolean {
  return allowlist.some((allowed) => matchesOutboundTestPhone(phone, allowed));
}

function madridNowLabel(date = new Date()): string {
  return new Intl.DateTimeFormat('es-ES', {
    timeZone: 'Europe/Madrid',
    dateStyle: 'short',
    timeStyle: 'medium',
    hourCycle: 'h23',
  }).format(date);
}

async function main(): Promise<void> {
  const urls = preferReachableRailwayUrls();
  if (!asJson) {
    console.log(
      `[audit] db=${redactUrl(urls.database)} redis=${redactUrl(urls.redis)}`,
    );
  }

  const prisma = new PrismaClient();
  const queue = new Queue(QUEUE, { connection: { url: urls.redis } });
  const now = new Date();
  const allowlist = resolvePhase3PhoneAllowlist(
    process.env.NURTURING_PHASE3_PHONE_ALLOWLIST,
  );
  const phase3On = isNurturingPhase3Enabled(
    process.env.NURTURING_PHASE3_ENABLED,
  );

  try {
    const leadByStatus = await prisma.lead.groupBy({
      by: ['status'],
      _count: { _all: true },
    });

    const candidates = await prisma.lead.findMany({
      where: {
        status: { in: [LeadStatus.nuevo, LeadStatus.pendiente, LeadStatus.interesado] },
      },
      include: {
        enrollments: {
          where: { status: EnrollmentStatus.active },
          include: {
            stepRuns: {
              where: {
                status: {
                  in: [
                    StepRunStatus.pending,
                    StepRunStatus.scheduled,
                    StepRunStatus.processing,
                  ],
                },
              },
              include: { step: true },
              orderBy: { scheduledFor: 'asc' },
            },
            sequence: true,
          },
        },
      },
      orderBy: { updatedAt: 'desc' },
      take: 500,
    });

    const allowlisted = candidates.filter((lead) =>
      inAllowlist(lead.phone, allowlist),
    );
    const withActiveEnrollment = allowlisted.filter(
      (lead) => lead.enrollments.length > 0,
    );
    const suppressed = allowlisted.filter((lead) => {
      const meta = (lead.metadata as Record<string, unknown> | null) || {};
      return Boolean(meta.nurturing_suppressed);
    });

    const openSteps = await prisma.sequenceStepRun.findMany({
      where: {
        status: {
          in: [
            StepRunStatus.pending,
            StepRunStatus.scheduled,
            StepRunStatus.processing,
          ],
        },
        enrollment: { status: EnrollmentStatus.active },
      },
      include: {
        step: true,
        enrollment: { include: { lead: true } },
      },
      orderBy: { scheduledFor: 'asc' },
      take: 500,
    });

    const openAllowlisted = openSteps.filter((run) =>
      inAllowlist(run.enrollment.lead.phone, allowlist),
    );
    const dueNow = openAllowlisted.filter((run) => run.scheduledFor <= now);
    const dueTodayMadrid = openAllowlisted.filter((run) => {
      const day = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Europe/Madrid',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(run.scheduledFor);
      const today = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Europe/Madrid',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(now);
      return day === today;
    });

    const bullmqCounts = await queue.getJobCounts(
      'waiting',
      'delayed',
      'active',
      'failed',
      'completed',
      'paused',
      'prioritized',
    );

    const delayedJobs = await queue.getJobs(['delayed', 'waiting', 'active'], 0, 99);
    const bullmqSample = delayedJobs.map((job) => {
      const delayMs = job.opts.delay ?? 0;
      const processAtMs = (job.timestamp || now.getTime()) + delayMs;
      return {
        jobId: job.id,
        state: 'unknown',
        stepRunId: job.data?.stepRunId,
        leadId: job.data?.leadId,
        processAt: new Date(processAtMs).toISOString(),
        processAtMadrid: madridNowLabel(new Date(processAtMs)),
        overdue: processAtMs <= now.getTime(),
      };
    });
    for (const sample of bullmqSample) {
      if (!sample.jobId) continue;
      sample.state = await queue.getJobState(sample.jobId);
    }

    const recentSheetsIngest = await prisma.lead.findMany({
      where: {
        OR: [
          { source: 'sheets_sync' },
          { source: { contains: 'sheets' } },
        ],
        updatedAt: { gte: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000) },
      },
      orderBy: { updatedAt: 'desc' },
      take: 20,
      select: {
        id: true,
        phone: true,
        status: true,
        source: true,
        sheetsRowNumber: true,
        updatedAt: true,
        createdAt: true,
      },
    });

    const sheetsSyncCount7d = await prisma.lead.count({
      where: {
        source: 'sheets_sync',
        createdAt: { gte: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000) },
      },
    });

    const report = {
      atUtc: now.toISOString(),
      atMadrid: madridNowLabel(now),
      gates: {
        NURTURING_PHASE3_ENABLED: process.env.NURTURING_PHASE3_ENABLED ?? null,
        phase3On,
        NURTURING_FAST_TEST: process.env.NURTURING_FAST_TEST ?? null,
        allowlist,
        defaultToni: PHASE3_TONI_PHONE_E164,
      },
      note: [
        'Fase 3 no lee el Sheet para discar: enrolla desde webhook Retell → Lead + BullMQ.',
        'El cron diario de llamadas (Fase 1) lee Localizados directamente, no la tabla Lead.',
        'Sheets→Lead es ingest a las 03:00 (SheetsLeadSyncService); no dispara T+7/T+10 solo.',
      ],
      leadStatusCounts: Object.fromEntries(
        leadByStatus.map((row) => [row.status, row._count._all]),
      ),
      fase3Eligibility: {
        nonTerminalLeadsSampled: candidates.length,
        allowlistedNonTerminal: allowlisted.length,
        allowlistedWithActiveEnrollment: withActiveEnrollment.length,
        allowlistedSuppressedInMetadata: suppressed.length,
        /** Listos conceptualmente: allowlist + no terminal + enrollment activo con pasos abiertos */
        readyForFollowupCalls: withActiveEnrollment.filter((lead) =>
          lead.enrollments.some((enroll) => enroll.stepRuns.length > 0),
        ).length,
        allowlistedLeads: allowlisted.map((lead) => ({
          id: lead.id,
          phone: lead.phone,
          status: lead.status,
          source: lead.source,
          sheetsRowNumber: lead.sheetsRowNumber,
          suppressed: Boolean(
            ((lead.metadata as Record<string, unknown> | null) || {})
              .nurturing_suppressed,
          ),
          lastOutcome: ((lead.metadata as Record<string, unknown> | null) || {})
            .last_outcome,
          lastPhase: ((lead.metadata as Record<string, unknown> | null) || {})
            .last_phase,
          activeEnrollments: lead.enrollments.map((enroll) => ({
            id: enroll.id,
            sequence: enroll.sequence.name,
            openSteps: enroll.stepRuns.map((run) => ({
              templateKey: run.step.templateKey,
              label:
                run.step.templateKey === TEMPLATE_CALL_FOLLOWUP_D7
                  ? 'T+7'
                  : run.step.templateKey === TEMPLATE_CALL_FOLLOWUP_D10
                    ? 'T+10'
                    : run.step.templateKey,
              status: run.status,
              scheduledFor: run.scheduledFor.toISOString(),
              scheduledForMadrid: madridNowLabel(run.scheduledFor),
              due: run.scheduledFor <= now,
              jobId: run.jobId,
            })),
          })),
        })),
      },
      bullmq: {
        queue: QUEUE,
        counts: bullmqCounts,
        openStepRunsAllowlisted: openAllowlisted.length,
        dueNow: dueNow.length,
        dueTodayMadrid: dueTodayMadrid.length,
        dueNowDetail: dueNow.map((run) => ({
          stepRunId: run.id,
          phone: run.enrollment.lead.phone,
          templateKey: run.step.templateKey,
          scheduledForMadrid: madridNowLabel(run.scheduledFor),
          status: run.status,
          jobId: run.jobId,
          lastError: run.lastError,
        })),
        dueTodayDetail: dueTodayMadrid.map((run) => ({
          stepRunId: run.id,
          phone: run.enrollment.lead.phone,
          templateKey: run.step.templateKey,
          scheduledForMadrid: madridNowLabel(run.scheduledFor),
          status: run.status,
          jobId: run.jobId,
        })),
        jobsSample: bullmqSample,
      },
      sheetsToDb: {
        createdFromSheetsSyncLast7d: sheetsSyncCount7d,
        recentSheetsSyncLeads: recentSheetsIngest.map((lead) => ({
          ...lead,
          updatedAt: lead.updatedAt.toISOString(),
          createdAt: lead.createdAt.toISOString(),
          inAllowlist: inAllowlist(lead.phone, allowlist),
        })),
      },
    };

    if (asJson) {
      console.log(JSON.stringify(report, null, 2));
      return;
    }

    console.log(`\n=== Audit Fase 3 ready @ ${report.atMadrid} (Madrid) ===`);
    console.log(
      `phase3On=${phase3On} fastTest=${report.gates.NURTURING_FAST_TEST} allowlist=${allowlist.join(',')}`,
    );
    console.log('\n--- Lead.status (todos) ---');
    console.log(report.leadStatusCounts);
    console.log('\n--- Elegibles Fase 3 (allowlist ∩ no terminal) ---');
    console.log(
      `  allowlisted=${report.fase3Eligibility.allowlistedNonTerminal} con enrollment activo=${report.fase3Eligibility.allowlistedWithActiveEnrollment} listos con pasos abiertos=${report.fase3Eligibility.readyForFollowupCalls} suppressed=${report.fase3Eligibility.allowlistedSuppressedInMetadata}`,
    );
    for (const lead of report.fase3Eligibility.allowlistedLeads) {
      console.log(
        `  lead=${lead.id} phone=${lead.phone} status=${lead.status} source=${lead.source} suppressed=${lead.suppressed} last=${lead.lastPhase}/${lead.lastOutcome}`,
      );
      for (const enroll of lead.activeEnrollments) {
        for (const step of enroll.openSteps) {
          console.log(
            `    → ${step.label} status=${step.status} due=${step.due} @ ${step.scheduledForMadrid} job=${step.jobId || '-'}`,
          );
        }
        if (enroll.openSteps.length === 0) {
          console.log(`    → enrollment ${enroll.id} sin pasos abiertos`);
        }
      }
    }

    console.log(`\n--- BullMQ ${QUEUE} ---`);
    console.log(bullmqCounts);
    console.log(
      `  open allowlisted=${openAllowlisted.length} dueNow=${dueNow.length} dueTodayMadrid=${dueTodayMadrid.length}`,
    );
    for (const row of report.bullmq.dueTodayDetail) {
      console.log(
        `  HOY ${row.templateKey} phone=${row.phone} @ ${row.scheduledForMadrid} status=${row.status} job=${row.jobId || '-'}`,
      );
    }

    console.log('\n--- Sheets → Lead (ingest, no dialer) ---');
    console.log(
      `  creados source=sheets_sync últimos 7d: ${sheetsSyncCount7d}`,
    );
    for (const lead of report.sheetsToDb.recentSheetsSyncLeads.slice(0, 10)) {
      console.log(
        `  ${lead.updatedAt} phone=${lead.phone} status=${lead.status} row=${lead.sheetsRowNumber ?? '-'} allowlist=${lead.inAllowlist}`,
      );
    }
    console.log(
      '\nNota: el lote diario de llamadas (Fase 1) no usa esta tabla; lee Google Sheets.\n',
    );
  } finally {
    await queue.close();
    await prisma.$disconnect();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
