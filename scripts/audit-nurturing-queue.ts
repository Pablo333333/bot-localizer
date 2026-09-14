/**
 * Auditoría global cola BullMQ `nurturing-steps` + SequenceStepRun (Prisma).
 * Sirve para detectar backlog / huérfanos antes de reactivar Railway.
 *
 * Uso (con acceso a Redis/Postgres de Railway):
 *   railway run npx ts-node -r tsconfig-paths/register scripts/audit-nurturing-queue.ts
 *
 * Flags:
 *   --limit=100     cuántos jobs listar por estado (default 50)
 *   --json          salida JSON (sin tablas)
 */
import 'dotenv/config';
import { PrismaClient, StepRunStatus } from '@prisma/client';
import { Queue } from 'bullmq';

const QUEUE = 'nurturing-steps';
const args = process.argv.slice(2);
const asJson = args.includes('--json');
const limitArg = args.find((a) => a.startsWith('--limit='));
const limit = Math.min(
  200,
  Math.max(10, Number.parseInt(limitArg?.split('=')[1] || '50', 10) || 50),
);

type JobState =
  | 'waiting'
  | 'delayed'
  | 'active'
  | 'failed'
  | 'completed'
  | 'paused'
  | 'prioritized';

async function summarizeJobs(
  queue: Queue,
  states: JobState[],
): Promise<
  Array<{
    jobId: string | undefined;
    state: string;
    stepRunId?: string;
    enrollmentId?: string;
    leadId?: string;
    processAt: string | null;
    overdue: boolean;
    attemptsMade: number;
    failedReason?: string;
  }>
> {
  const now = Date.now();
  const out: Array<{
    jobId: string | undefined;
    state: string;
    stepRunId?: string;
    enrollmentId?: string;
    leadId?: string;
    processAt: string | null;
    overdue: boolean;
    attemptsMade: number;
    failedReason?: string;
  }> = [];

  for (const state of states) {
    const jobs = await queue.getJobs([state], 0, limit - 1);
    for (const job of jobs) {
      const delayMs = job.opts.delay ?? 0;
      const processAtMs =
        state === 'delayed'
          ? (job.timestamp || now) + delayMs
          : job.processedOn || job.timestamp || now;
      const processAt = new Date(processAtMs);
      const overdue =
        state === 'waiting' ||
        state === 'active' ||
        (state === 'delayed' && processAtMs <= now) ||
        (state === 'failed' && true);
      out.push({
        jobId: job.id,
        state,
        stepRunId: job.data?.stepRunId,
        enrollmentId: job.data?.enrollmentId,
        leadId: job.data?.leadId,
        processAt: processAt.toISOString(),
        overdue: Boolean(overdue && (state === 'waiting' || state === 'delayed')),
        attemptsMade: job.attemptsMade,
        failedReason:
          state === 'failed'
            ? String(job.failedReason || '').slice(0, 160)
            : undefined,
      });
    }
  }
  return out;
}

async function main() {
  const prisma = new PrismaClient();
  const redisUrl = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
  const queue = new Queue(QUEUE, { connection: { url: redisUrl } });
  const now = new Date();

  try {
    const counts = await queue.getJobCounts(
      'waiting',
      'delayed',
      'active',
      'failed',
      'completed',
      'paused',
      'prioritized',
    );

    const openStatuses: StepRunStatus[] = [
      StepRunStatus.pending,
      StepRunStatus.scheduled,
      StepRunStatus.processing,
    ];

    const stepRuns = await prisma.sequenceStepRun.findMany({
      where: { status: { in: openStatuses } },
      include: {
        step: true,
        enrollment: { include: { lead: true } },
      },
      orderBy: { scheduledFor: 'asc' },
      take: 500,
    });

    const byStatus = await prisma.sequenceStepRun.groupBy({
      by: ['status'],
      _count: { _all: true },
    });

    const listed = await summarizeJobs(queue, [
      'waiting',
      'delayed',
      'active',
      'failed',
      'prioritized',
    ]);

    const redisJobIds = new Set(
      listed.map((j) => j.jobId).filter(Boolean) as string[],
    );
    // También comprobar jobId guardado en Prisma aunque no esté en el sample
    const redisPresence: Record<string, boolean | 'unknown'> = {};
    for (const sr of stepRuns) {
      const jid = sr.jobId || `nurturing:step-run:${sr.id}`;
      if (redisJobIds.has(jid)) {
        redisPresence[sr.id] = true;
        continue;
      }
      try {
        const job = await queue.getJob(jid);
        redisPresence[sr.id] = Boolean(job);
      } catch {
        redisPresence[sr.id] = 'unknown';
      }
    }

    const overdueDb = stepRuns.filter((sr) => sr.scheduledFor <= now);
    const orphansDbNoRedis = stepRuns.filter(
      (sr) => redisPresence[sr.id] === false,
    );
    const readyBurstRisk =
      (counts.waiting || 0) +
      listed.filter((j) => j.state === 'delayed' && j.overdue).length;

    const report = {
      at: now.toISOString(),
      phase3: process.env.NURTURING_PHASE3_ENABLED,
      queue: QUEUE,
      bullmqCounts: counts,
      /** Jobs waiting/active = ya vencidos o en curso; al arrancar el worker saldrán en ráfaga */
      backlogHint: {
        waiting: counts.waiting || 0,
        active: counts.active || 0,
        failed: counts.failed || 0,
        delayed: counts.delayed || 0,
        estimatedImmediateDialRisk: readyBurstRisk,
      },
      prismaStepRunCounts: Object.fromEntries(
        byStatus.map((r) => [r.status, r._count._all]),
      ),
      openStepRuns: stepRuns.length,
      overdueOpenStepRuns: overdueDb.length,
      orphansDbScheduledNoRedisJob: orphansDbNoRedis.length,
      jobsSample: listed,
      overdueStepRuns: overdueDb.map((sr) => ({
        id: sr.id,
        status: sr.status,
        scheduledFor: sr.scheduledFor.toISOString(),
        jobId: sr.jobId,
        redisJobExists: redisPresence[sr.id],
        templateKey: sr.step.templateKey,
        delayMinutes: sr.step.delayMinutes,
        label:
          sr.step.delayMinutes === 10_080
            ? 'T+7'
            : sr.step.delayMinutes === 14_400
              ? 'T+10'
              : `T+${Math.round(sr.step.delayMinutes / 1440)}d`,
        leadId: sr.enrollment.leadId,
        leadPhone: sr.enrollment.lead.phone,
        enrollmentStatus: sr.enrollment.status,
        lastError: sr.lastError,
      })),
      orphanStepRuns: orphansDbNoRedis.map((sr) => ({
        id: sr.id,
        status: sr.status,
        scheduledFor: sr.scheduledFor.toISOString(),
        jobId: sr.jobId,
        leadPhone: sr.enrollment.lead.phone,
        templateKey: sr.step.templateKey,
      })),
    };

    if (asJson) {
      console.log(JSON.stringify(report, null, 2));
      return;
    }

    console.log(`\n=== Audit nurturing queue @ ${report.at} ===`);
    console.log(`NURTURING_PHASE3_ENABLED=${report.phase3}`);
    console.log(`\n--- BullMQ counts (${QUEUE}) ---`);
    console.log(counts);
    console.log('\n--- Riesgo al arrancar worker ---');
    console.log(
      `  waiting+overdue≈${readyBurstRisk} jobs podrían dispararse en cuanto el worker esté up`,
    );
    console.log(`  failed=${counts.failed || 0} (revisar / reintentar manual)`);

    console.log('\n--- Prisma SequenceStepRun (groupBy) ---');
    console.log(report.prismaStepRunCounts);
    console.log(
      `  open(pending|scheduled|processing)=${stepRuns.length}  overdue=${overdueDb.length}  huérfanos(DB sin job Redis)=${orphansDbNoRedis.length}`,
    );

    if (listed.length) {
      console.log(`\n--- Sample jobs (hasta ${limit}/estado) ---`);
      for (const j of listed) {
        console.log(
          `  [${j.state}] job=${j.jobId} overdue=${j.overdue} processAt=${j.processAt} attempts=${j.attemptsMade}`,
        );
        console.log(
          `           stepRun=${j.stepRunId} lead=${j.leadId}${j.failedReason ? ` err=${j.failedReason}` : ''}`,
        );
      }
    } else {
      console.log('\n--- Sample jobs: (vacío en waiting/delayed/active/failed) ---');
    }

    if (overdueDb.length) {
      console.log('\n--- StepRuns OPEN con scheduledFor <= ahora (backlog DB) ---');
      for (const sr of report.overdueStepRuns.slice(0, 40)) {
        console.log(
          `  [${sr.label}] ${sr.id} status=${sr.status} due=${sr.scheduledFor} redis=${sr.redisJobExists} phone=${sr.leadPhone}`,
        );
      }
      if (overdueDb.length > 40) {
        console.log(`  … +${overdueDb.length - 40} más`);
      }
    }

    if (orphansDbNoRedis.length) {
      console.log(
        '\n--- Huérfanos: DB scheduled/pending sin job en Redis (hay que recalcular o cancelar) ---',
      );
      for (const sr of report.orphanStepRuns.slice(0, 40)) {
        console.log(
          `  ${sr.id} status=${sr.status} due=${sr.scheduledFor} jobId=${sr.jobId} phone=${sr.leadPhone} ${sr.templateKey}`,
        );
      }
    }

    console.log('\nTip: también GET /nurturing/sync/queue-jobs (x-api-key) para un phone concreto.\n');
  } finally {
    await queue.close();
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
