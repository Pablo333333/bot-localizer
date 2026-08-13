import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SequenceStep, StepRunStatus } from '@prisma/client';
import { Queue } from 'bullmq';
import { PrismaService } from '../../prisma/prisma.service';
import { NURTURING_STEP_JOB, NURTURING_STEPS_QUEUE } from '../../queue/queue.constants';
import {
  NURTURING_PHASE3_DISABLED_LOG,
  isNurturingPhase3Enabled,
} from '../phase3-enabled';
import { NurturingStepJobData, stepRunJobId } from './nurturing-step.job';

@Injectable()
export class SequenceScheduler {
  private readonly logger = new Logger(SequenceScheduler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    @InjectQueue(NURTURING_STEPS_QUEUE) private readonly queue: Queue<NurturingStepJobData>,
  ) {}

  /**
   * Crea SequenceStepRuns y encola jobs BullMQ con el delay de cada paso.
   */
  async scheduleEnrollmentSteps(
    enrollmentId: string,
    leadId: string,
    steps: SequenceStep[],
    enrolledAt: Date = new Date(),
  ): Promise<void> {
    if (
      !isNurturingPhase3Enabled(this.config.get('NURTURING_PHASE3_ENABLED'))
    ) {
      this.logger.log(NURTURING_PHASE3_DISABLED_LOG);
      return;
    }

    const ordered = [...steps].sort((a, b) => a.order - b.order);

    for (const step of ordered) {
      const scheduledFor = new Date(enrolledAt.getTime() + step.delayMinutes * 60_000);
      const delayMs = Math.max(0, scheduledFor.getTime() - Date.now());

      const stepRun = await this.prisma.sequenceStepRun.create({
        data: {
          enrollmentId,
          stepId: step.id,
          status: StepRunStatus.scheduled,
          scheduledFor,
          attempts: 0,
        },
      });

      const jobId = stepRunJobId(stepRun.id);
      const job = await this.queue.add(
        NURTURING_STEP_JOB,
        {
          stepRunId: stepRun.id,
          enrollmentId,
          leadId,
        },
        {
          jobId,
          delay: delayMs,
          attempts: Math.max(1, step.maxRetries),
          backoff: { type: 'exponential', delay: 60_000 },
          removeOnComplete: 100,
          removeOnFail: 200,
        },
      );

      await this.prisma.sequenceStepRun.update({
        where: { id: stepRun.id },
        data: { jobId: job.id ?? jobId },
      });

      this.logger.log(
        `Scheduled stepRun=${stepRun.id} lead=${leadId} channel=${step.channel} delayMs=${delayMs}`,
      );
    }
  }

  async cancelJobs(jobIds: Array<string | null | undefined>): Promise<number> {
    let cancelled = 0;
    for (const jobId of jobIds) {
      if (!jobId) continue;
      try {
        const job = await this.queue.getJob(jobId);
        if (job) {
          await job.remove();
          cancelled += 1;
        }
      } catch (error) {
        this.logger.warn(
          `Could not remove job ${jobId}: ${error instanceof Error ? error.message : error}`,
        );
      }
    }
    return cancelled;
  }
}
