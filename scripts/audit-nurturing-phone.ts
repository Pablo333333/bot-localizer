/**
 * Auditoría T+7/T+10 para un teléfono (p.ej. Toni).
 *
 * Uso en Railway (donde hay acceso a postgres/redis internos):
 *   railway run npx ts-node -r tsconfig-paths/register scripts/audit-nurturing-phone.ts +34644408099
 *
 * O contra el API del servicio (si está desplegado):
 *   curl -H "x-api-key: $NURTURING_API_KEY" \
 *     "https://<host>/nurturing/sync/queue-jobs?phone=644408099"
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { Queue } from 'bullmq';

const phoneArg = process.argv[2] || '+34644408099';
const digits = phoneArg.replace(/\D/g, '').slice(-9);

async function main() {
  const prisma = new PrismaClient();
  const redisUrl = process.env.REDIS_URL || 'redis://127.0.0.1:6379';

  console.log(`\n=== Audit nurturing phone=${phoneArg} (digits…${digits}) ===\n`);
  console.log(`NURTURING_PHASE3_ENABLED=${process.env.NURTURING_PHASE3_ENABLED}`);
  console.log(`NURTURING_T0_CHANNEL=${process.env.NURTURING_T0_CHANNEL || 'whatsapp (default)'}`);

  const lead = await prisma.lead.findFirst({
    where: { phone: { contains: digits } },
    orderBy: { updatedAt: 'desc' },
    include: {
      enrollments: {
        orderBy: { enrolledAt: 'desc' },
        take: 3,
        include: {
          stepRuns: {
            include: { step: true },
            orderBy: { scheduledFor: 'asc' },
          },
        },
      },
      communications: { orderBy: { createdAt: 'desc' }, take: 10 },
    },
  });

  if (!lead) {
    console.log('\n❌ No hay Lead en Postgres para ese teléfono.');
    console.log(
      '   Si la llamada fue reciente y Phase3 estaba OFF, el follow-up no creó lead/jobs.',
    );
    await prisma.$disconnect();
    process.exit(1);
  }

  console.log('\n--- Lead ---');
  console.log({
    id: lead.id,
    phone: lead.phone,
    status: lead.status,
    metadata: lead.metadata,
  });

  console.log('\n--- Communications (últimas) ---');
  for (const c of lead.communications) {
    console.log(
      `  ${c.createdAt.toISOString()} ${c.channel} ${c.summary} ref=${c.providerRef}`,
    );
  }

  console.log('\n--- Enrollments / StepRuns (Prisma) ---');
  for (const en of lead.enrollments) {
    console.log(
      `  enrollment=${en.id} status=${en.status} enrolledAt=${en.enrolledAt.toISOString()}`,
    );
    for (const sr of en.stepRuns) {
      const days = Math.round((sr.step.delayMinutes / 1440) * 10) / 10;
      const label =
        sr.step.delayMinutes === 10080
          ? 'T+7'
          : sr.step.delayMinutes === 14400
            ? 'T+10'
            : `T+${days}d`;
      console.log(
        `    [${label}] stepRun=${sr.id} status=${sr.status} jobId=${sr.jobId}`,
      );
      console.log(
        `           template=${sr.step.templateKey} scheduledFor=${sr.scheduledFor.toISOString()} (delayMinutes=${sr.step.delayMinutes})`,
      );
    }
  }

  console.log('\n--- BullMQ delayed (nurturing-steps) ---');
  const queue = new Queue('nurturing-steps', { connection: { url: redisUrl } });
  try {
    const delayed = await queue.getJobs(['delayed'], 0, 49);
    const mine = delayed.filter((j) => j.data?.leadId === lead.id);
    if (mine.length === 0) {
      console.log('  (ningún job delayed en Redis para este leadId)');
    }
    for (const job of mine) {
      const delayMs = job.opts.delay ?? 0;
      const processAt = new Date((job.timestamp || Date.now()) + delayMs);
      console.log(
        `  jobId=${job.id} state=delayed delayMs=${delayMs} processAt=${processAt.toISOString()}`,
      );
      console.log(`    data=${JSON.stringify(job.data)}`);
    }
  } catch (err) {
    console.error(
      '  Error leyendo Redis/BullMQ:',
      err instanceof Error ? err.message : err,
    );
    console.log(
      '  Tip: ejecuta este script con `railway run` para usar redis.railway.internal',
    );
  } finally {
    await queue.close();
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
