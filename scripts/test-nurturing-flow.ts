/**
 * E2E aislado del flujo Fase 3 (nurturing):
 * create lead → enroll → validar StepRuns T+7/T+10 →
 * status cita_programada → cancel jobs → metrics → cleanup
 *
 * Uso:
 *   NURTURING_MOCK_CHANNELS=true npx ts-node -r tsconfig-paths/register scripts/test-nurturing-flow.ts
 */
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { Queue } from 'bullmq';
import {
  Channel,
  EnrollmentStatus,
  StepRunStatus,
} from '@prisma/client';
import { getQueueToken } from '@nestjs/bullmq';
import { PrismaModule } from '../src/prisma/prisma.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { QueueModule } from '../src/queue/queue.module';
import {
  NURTURING_STEPS_QUEUE,
} from '../src/queue/queue.constants';
import { CallChannel } from '../src/nurturing/channels/call.channel';
import { ChannelRegistry } from '../src/nurturing/channels/channel.registry';
import { EmailChannel } from '../src/nurturing/channels/email.channel';
import { SmsChannel } from '../src/nurturing/channels/sms.channel';
import { WhatsappChannel } from '../src/nurturing/channels/whatsapp.channel';
import { EnrollmentsService } from '../src/nurturing/enrollments/enrollments.service';
import { SequenceProcessor } from '../src/nurturing/engine/sequence.processor';
import { SequenceScheduler } from '../src/nurturing/engine/sequence.scheduler';
import { stepRunJobId } from '../src/nurturing/engine/nurturing-step.job';
import { LeadsService } from '../src/nurturing/leads/leads.service';
import { MetricsService } from '../src/nurturing/metrics/metrics.service';
import { SequencesService } from '../src/nurturing/sequences/sequences.service';
import { SheetsLeadSyncService } from '../src/nurturing/sync/sheets-lead-sync.service';
import { LeadStatus } from '../src/nurturing/enums';
import { NurturingStepJobData } from '../src/nurturing/engine/nurturing-step.job';

const TEST_PHONE = '+34600000000';
const TEST_EMAIL = 'nurturing-e2e@example.com';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`ASSERT FAIL: ${message}`);
  }
}

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    QueueModule,
  ],
  providers: [
    {
      provide: SheetsLeadSyncService,
      useValue: {
        ingestFromSheets: async () => ({
          imported: 0,
          updated: 0,
          skipped: 0,
          totalRows: 0,
        }),
        syncStatusToSheets: async (
          phone: string,
          status: string,
          row?: number | null,
        ) => {
          console.log(
            `[MOCK Sheets sync] phone=${phone} status=${status} row=${row ?? 'n/a'}`,
          );
        },
      },
    },
    LeadsService,
    SequencesService,
    MetricsService,
    EnrollmentsService,
    SequenceScheduler,
    SequenceProcessor,
    ChannelRegistry,
    WhatsappChannel,
    EmailChannel,
    SmsChannel,
    CallChannel,
  ],
})
class NurturingE2EModule {}

async function main() {
  process.env.NURTURING_MOCK_CHANNELS = 'true';
  process.env.NURTURING_PHASE3_ENABLED = 'true';

  console.log('\n=== Fase 3 E2E: Nurturing flow ===\n');

  const app = await NestFactory.createApplicationContext(NurturingE2EModule, {
    logger: ['error', 'warn', 'log'],
  });

  const prisma = app.get(PrismaService);
  const leads = app.get(LeadsService);
  const enrollments = app.get(EnrollmentsService);
  const metrics = app.get(MetricsService);
  const queue = app.get<Queue<NurturingStepJobData>>(
    getQueueToken(NURTURING_STEPS_QUEUE),
  );

  let leadId: string | null = null;

  try {
    // Evita que el WorkerHost procese jobs mientras controlamos el E2E
    await queue.pause();
    console.log('✓ Cola nurturing-steps en pausa (control manual del E2E)');

    // Cleanup leftover from previous failed runs
    const previous = await prisma.lead.findUnique({
      where: { phone: TEST_PHONE },
      include: { enrollments: { include: { stepRuns: true } } },
    });
    if (previous) {
      console.log(`Cleaning leftover test lead ${previous.id}...`);
      await cleanupLead(prisma, queue, previous.id);
    }

    // Ensure default sequence exists
    let sequence = await prisma.sequence.findFirst({
      where: { isDefault: true, isActive: true },
      include: { steps: { orderBy: { order: 'asc' } } },
    });
    if (!sequence) {
      throw new Error(
        'No hay secuencia default. Ejecuta: npm run prisma:seed',
      );
    }
    console.log(
      `✓ Secuencia default: ${sequence.name} (${sequence.steps.length} pasos)`,
    );
    for (const step of sequence.steps) {
      console.log(
        `  - order=${step.order} channel=${step.channel} delayMinutes=${step.delayMinutes}`,
      );
    }

    // 1) Create lead
    const created = await leads.create({
      phone: TEST_PHONE,
      email: TEST_EMAIL,
      name: 'Lead E2E Test',
      source: 'e2e_test',
      enrollInDefault: false,
    });
    leadId = created.lead.id;
    console.log(`\n✓ Lead creado: ${leadId} phone=${created.lead.phone}`);

    // 2) Enroll
    const enrollment = await enrollments.enrollLead(leadId);
    console.log(
      `✓ Enroll: enrollmentId=${enrollment.enrollmentId} steps=${enrollment.stepsScheduled}`,
    );

    const stepRuns = await prisma.sequenceStepRun.findMany({
      where: { enrollmentId: enrollment.enrollmentId },
      include: { step: true },
      orderBy: { scheduledFor: 'asc' },
    });

    assert(stepRuns.length === 2, `Expected 2 stepRuns (T+7, T+10), got ${stepRuns.length}`);

    const callD7 = stepRuns.find(
      (r) => r.step.channel === Channel.llamada && r.step.delayMinutes === 10080,
    );
    const callD10 = stepRuns.find(
      (r) => r.step.channel === Channel.llamada && r.step.delayMinutes === 14400,
    );
    assert(callD7, 'Missing stepRun Call T+7 (10080 min)');
    assert(callD10, 'Missing stepRun Call T+10 (14400 min)');

    console.log('\n✓ SequenceStepRuns programados:');
    for (const run of stepRuns) {
      const job = run.jobId ? await queue.getJob(run.jobId) : null;
      const state = job ? await job.getState() : 'missing';
      console.log(
        `  - ${run.step.channel} delay=${run.step.delayMinutes}m status=${run.status} jobId=${run.jobId} bullState=${state}`,
      );
      assert(run.jobId, `StepRun ${run.id} sin jobId`);
      assert(job, `BullMQ job missing for ${run.jobId}`);
      assert(
        state === 'delayed' || state === 'waiting' || state === 'prioritized',
        `Unexpected BullMQ state for ${run.step.channel}: ${state}`,
      );
    }

    // 3) Change status → cita_programada (auto-stop T+7 y T+10)
    console.log('\n→ PATCH status → cita_programada');
    const statusResult = await leads.updateStatus(leadId, {
      status: LeadStatus.CITA_PROGRAMADA,
      reason: 'e2e_test',
    });
    console.log(
      `✓ Status updated. sequencesStopped=${statusResult.sequencesStopped}`,
    );
    assert(statusResult.sequencesStopped >= 1, 'Expected at least 1 enrollment stopped');

    const afterCancel = await prisma.sequenceStepRun.findMany({
      where: { enrollmentId: enrollment.enrollmentId },
      include: { step: true },
      orderBy: { step: { order: 'asc' } },
    });

    const callD7Final = afterCancel.find(
      (r) => r.step.channel === Channel.llamada && r.step.delayMinutes === 10080,
    );
    const callD10Final = afterCancel.find(
      (r) => r.step.channel === Channel.llamada && r.step.delayMinutes === 14400,
    );

    assert(
      callD7Final?.status === StepRunStatus.cancelled,
      `Call T+7 stepRun should be cancelled, got ${callD7Final?.status}`,
    );
    assert(
      callD10Final?.status === StepRunStatus.cancelled,
      `Call T+10 stepRun should be cancelled, got ${callD10Final?.status}`,
    );

    for (const run of [callD7Final!, callD10Final!]) {
      const job = run.jobId ? await queue.getJob(run.jobId) : null;
      const state = job ? await job.getState() : 'absent';
      console.log(`  - ${run.step.channel} delay=${run.step.delayMinutes}: db=${run.status} bull=${state}`);
      assert(!job, `BullMQ job still present for cancelled ${run.step.channel}`);
    }

    const enrollmentAfter = await prisma.sequenceEnrollment.findUnique({
      where: { id: enrollment.enrollmentId },
    });
    assert(
      enrollmentAfter?.status === EnrollmentStatus.cancelled,
      `Enrollment status=${enrollmentAfter?.status}`,
    );
    console.log('✓ Enrollment cancelled; jobs T+7 y T+10 eliminados');

    // 5) Metrics summary
    const summary = await metrics.getSummary({});
    console.log('\n=== Metrics summary ===');
    console.log(JSON.stringify(summary, null, 2));
    assert(summary.leadsGenerated >= 1, 'metrics.leadsGenerated expected >= 1');
    assert(
      typeof summary.visitScheduledRate === 'number',
      'visitScheduledRate missing',
    );
    assert(typeof summary.closedRate === 'number', 'closedRate missing');

    console.log('\n✅ E2E PASSED\n');
  } catch (error) {
    console.error('\n❌ E2E FAILED:', error);
    process.exitCode = 1;
  } finally {
    if (leadId) {
      console.log(`Cleaning up test lead ${leadId}...`);
      await cleanupLead(prisma, queue, leadId);
      console.log('✓ Cleanup done');
    }
    try {
      await queue.resume();
    } catch {
      /* ignore */
    }
    await app.close();
  }
}

async function cleanupLead(
  prisma: PrismaService,
  queue: Queue,
  leadId: string,
) {
  const enrollments = await prisma.sequenceEnrollment.findMany({
    where: { leadId },
    include: { stepRuns: true },
  });

  for (const enrollment of enrollments) {
    for (const run of enrollment.stepRuns) {
      const ids = [run.jobId, stepRunJobId(run.id)].filter(Boolean) as string[];
      for (const id of ids) {
        try {
          const job = await queue.getJob(id);
          if (job) await job.remove();
        } catch {
          /* ignore */
        }
      }
    }
    await prisma.executionErrorLog.deleteMany({
      where: { stepRunId: { in: enrollment.stepRuns.map((r) => r.id) } },
    });
    await prisma.sequenceStepRun.deleteMany({
      where: { enrollmentId: enrollment.id },
    });
  }

  await prisma.communicationLog.deleteMany({ where: { leadId } });
  await prisma.sequenceEnrollment.deleteMany({ where: { leadId } });
  await prisma.lead.deleteMany({ where: { id: leadId } });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
