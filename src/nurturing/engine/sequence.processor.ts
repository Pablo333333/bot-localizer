import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import {
  EnrollmentStatus,
  LeadStatus,
  Prisma,
  StepRunStatus,
} from '@prisma/client';
import { Job } from 'bullmq';
import { PrismaService } from '../../prisma/prisma.service';
import { NURTURING_STEPS_QUEUE } from '../../queue/queue.constants';
import { ChannelRegistry } from '../channels/channel.registry';
import { LeadStatus as AppLeadStatus, TERMINAL_LEAD_STATUSES } from '../enums';
import { NurturingStepJobData } from './nurturing-step.job';

@Processor(NURTURING_STEPS_QUEUE)
export class SequenceProcessor extends WorkerHost {
  private readonly logger = new Logger(SequenceProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly channels: ChannelRegistry,
  ) {
    super();
  }

  async process(job: Job<NurturingStepJobData>): Promise<{ status: string }> {
    const { stepRunId, enrollmentId, leadId } = job.data;
    this.logger.log(
      `Processing job=${job.id} stepRun=${stepRunId} attempt=${job.attemptsMade + 1}`,
    );

    const stepRun = await this.prisma.sequenceStepRun.findUnique({
      where: { id: stepRunId },
      include: {
        step: true,
        enrollment: {
          include: { lead: true },
        },
      },
    });

    if (!stepRun) {
      this.logger.warn(`StepRun ${stepRunId} not found — skipping`);
      return { status: 'missing' };
    }

    if (
      stepRun.status === StepRunStatus.cancelled ||
      stepRun.status === StepRunStatus.sent ||
      stepRun.status === StepRunStatus.skipped
    ) {
      return { status: stepRun.status };
    }

    const { enrollment } = stepRun;
    const lead = enrollment.lead;

    if (enrollment.status !== EnrollmentStatus.active) {
      await this.markSkipped(stepRunId, `enrollment_${enrollment.status}`);
      return { status: 'skipped' };
    }

    if (this.isTerminal(lead.status)) {
      await this.markSkipped(stepRunId, `lead_status:${lead.status}`);
      return { status: 'skipped' };
    }

    if (lead.id !== leadId && leadId) {
      this.logger.warn(
        `Job leadId mismatch (job=${leadId}, db=${lead.id}) — using DB lead`,
      );
    }

    await this.prisma.sequenceStepRun.update({
      where: { id: stepRunId },
      data: {
        status: StepRunStatus.processing,
        startedAt: stepRun.startedAt ?? new Date(),
        attempts: { increment: 1 },
      },
    });

    const adapter = this.channels.get(stepRun.step.channel);
    const templatePayload = (stepRun.step.templatePayload ?? {}) as Record<
      string,
      unknown
    >;

    const result = await adapter.send({
      leadId: lead.id,
      phone: lead.phone,
      email: lead.email,
      name: lead.name,
      templateKey: stepRun.step.templateKey,
      templatePayload,
      stepRunId,
    });

    if (!result.success) {
      const errorMessage = result.error || 'Channel send failed';
      await this.prisma.executionErrorLog.create({
        data: {
          stepRunId,
          code: 'channel_send_failed',
          message: errorMessage,
          payload: {
            channel: stepRun.step.channel,
            attempt: job.attemptsMade + 1,
            enrollmentId,
          } as Prisma.InputJsonValue,
        },
      });

      await this.prisma.sequenceStepRun.update({
        where: { id: stepRunId },
        data: { lastError: errorMessage },
      });

      const maxAttempts = job.opts.attempts ?? stepRun.step.maxRetries;
      if (job.attemptsMade + 1 >= maxAttempts) {
        await this.prisma.sequenceStepRun.update({
          where: { id: stepRunId },
          data: {
            status: StepRunStatus.failed,
            finishedAt: new Date(),
          },
        });
        await this.maybeCompleteEnrollment(enrollmentId);
        return { status: 'failed' };
      }

      throw new Error(errorMessage);
    }

    await this.prisma.$transaction([
      this.prisma.sequenceStepRun.update({
        where: { id: stepRunId },
        data: {
          status: StepRunStatus.sent,
          finishedAt: new Date(),
          providerRef: result.providerRef,
          lastError: null,
        },
      }),
      this.prisma.communicationLog.create({
        data: {
          leadId: lead.id,
          channel: stepRun.step.channel,
          direction: 'outbound',
          summary: `${stepRun.step.channel}:${stepRun.step.templateKey}`,
          providerRef: result.providerRef,
          stepRunId,
        },
      }),
      this.prisma.sequenceEnrollment.update({
        where: { id: enrollmentId },
        data: { currentStepOrder: stepRun.step.order },
      }),
    ]);

    await this.maybeCompleteEnrollment(enrollmentId);
    this.logger.log(`StepRun ${stepRunId} sent via ${stepRun.step.channel}`);
    return { status: 'sent' };
  }

  private isTerminal(status: LeadStatus): boolean {
    return TERMINAL_LEAD_STATUSES.has(status as AppLeadStatus);
  }

  private async markSkipped(stepRunId: string, reason: string): Promise<void> {
    await this.prisma.sequenceStepRun.update({
      where: { id: stepRunId },
      data: {
        status: StepRunStatus.skipped,
        finishedAt: new Date(),
        lastError: reason,
      },
    });
  }

  private async maybeCompleteEnrollment(enrollmentId: string): Promise<void> {
    const open = await this.prisma.sequenceStepRun.count({
      where: {
        enrollmentId,
        status: {
          in: [
            StepRunStatus.pending,
            StepRunStatus.scheduled,
            StepRunStatus.processing,
          ],
        },
      },
    });

    if (open > 0) return;

    const enrollment = await this.prisma.sequenceEnrollment.findUnique({
      where: { id: enrollmentId },
    });
    if (!enrollment || enrollment.status !== EnrollmentStatus.active) return;

    await this.prisma.sequenceEnrollment.update({
      where: { id: enrollmentId },
      data: {
        status: EnrollmentStatus.completed,
        completedAt: new Date(),
      },
    });
    this.logger.log(`Enrollment ${enrollmentId} completed`);
  }
}
