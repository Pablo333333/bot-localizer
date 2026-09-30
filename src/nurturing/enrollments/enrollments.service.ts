import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import {
  EnrollmentStatus,
  LeadStatus,
  StepRunStatus,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { LeadStatus as AppLeadStatus, TERMINAL_LEAD_STATUSES } from '../enums';
import {
  NURTURING_PHASE3_DISABLED_LOG,
  isNurturingPhase3Enabled,
} from '../phase3-enabled';
import {
  PHASE3_LEAD_NOT_ALLOWED_LOG,
  isPhase3AllowedPhone,
} from '../phase3-allowlist';
import { SequenceScheduler } from '../engine/sequence.scheduler';
import { lockPhase3Key } from '../engine/pg-advisory-lock';

@Injectable()
export class EnrollmentsService {
  private readonly logger = new Logger(EnrollmentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly scheduler: SequenceScheduler,
    private readonly config: ConfigService,
  ) {}

  async enrollLead(
    leadId: string,
    sequenceId?: string,
    options?: { replaceActive?: boolean },
  ): Promise<{ enrollmentId: string; sequenceId: string; stepsScheduled: number }> {
    if (
      !isNurturingPhase3Enabled(this.config.get('NURTURING_PHASE3_ENABLED'))
    ) {
      this.logger.log(NURTURING_PHASE3_DISABLED_LOG);
      throw new BadRequestException(NURTURING_PHASE3_DISABLED_LOG);
    }

    const lead = await this.prisma.lead.findUnique({ where: { id: leadId } });
    if (!lead) {
      throw new NotFoundException(`Lead ${leadId} not found`);
    }

    if (
      !isPhase3AllowedPhone(
        lead.phone,
        this.config.get('NURTURING_PHASE3_PHONE_ALLOWLIST'),
      )
    ) {
      this.logger.warn(
        `${PHASE3_LEAD_NOT_ALLOWED_LOG} lead=${leadId} phone=${lead.phone}`,
      );
      throw new BadRequestException(PHASE3_LEAD_NOT_ALLOWED_LOG);
    }

    if (TERMINAL_LEAD_STATUSES.has(lead.status as AppLeadStatus)) {
      throw new BadRequestException(
        `Cannot enroll lead in status ${lead.status}`,
      );
    }

    const sequence = sequenceId
      ? await this.prisma.sequence.findFirst({
          where: { id: sequenceId, isActive: true },
          include: { steps: { orderBy: { order: 'asc' } } },
        })
      : await this.prisma.sequence.findFirst({
          where: { isDefault: true, isActive: true },
          include: { steps: { orderBy: { order: 'asc' } } },
        });

    if (!sequence) {
      throw new NotFoundException(
        sequenceId
          ? `Sequence ${sequenceId} not found or inactive`
          : 'No default active sequence found — run prisma db seed',
      );
    }

    if (sequence.steps.length === 0) {
      throw new BadRequestException(`Sequence ${sequence.id} has no steps`);
    }

    const enrolledAt = new Date();
    const enrollment = await this.prisma.$transaction(async (tx) => {
      await lockPhase3Key(tx, `fase3-enroll:${leadId}`);

      if (options?.replaceActive) {
        const stopped = await this.cancelActiveEnrollments(tx, leadId, 'fast_test_restart');
        if (stopped > 0) {
          this.logger.warn(
            `[FASE3][BULLMQ] prueba rápida: enrollment anterior cancelado (${stopped}) para empezar el ciclo desde la llamada 1`,
          );
        }
      }

      const existingActive = await tx.sequenceEnrollment.findFirst({
        where: {
          leadId,
          sequenceId: sequence.id,
          status: EnrollmentStatus.active,
        },
      });
      if (existingActive) {
        throw new BadRequestException(
          `Lead already has an active enrollment on sequence ${sequence.id}`,
        );
      }

      return tx.sequenceEnrollment.create({
        data: {
          leadId,
          sequenceId: sequence.id,
          status: EnrollmentStatus.active,
          currentStepOrder: 1,
          enrolledAt,
        },
      });
    });

    const stepsScheduled = await this.scheduler.scheduleEnrollmentSteps(
      enrollment.id,
      leadId,
      sequence.steps,
      enrolledAt,
    );

    this.logger.log(
      `[FASE3][BULLMQ] enrolled lead=${leadId} sequence=${sequence.id} enrollment=${enrollment.id} pasosEncolados=${stepsScheduled}`,
    );

    return {
      enrollmentId: enrollment.id,
      sequenceId: sequence.id,
      stepsScheduled,
    };
  }

  private async cancelActiveEnrollments(
    tx: Prisma.TransactionClient,
    leadId: string,
    reason: string,
  ): Promise<number> {
    const active = await tx.sequenceEnrollment.findMany({
      where: { leadId, status: EnrollmentStatus.active },
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
        },
      },
    });
    if (active.length === 0) return 0;

    await this.scheduler.cancelJobs(
      active.flatMap((enrollment) => enrollment.stepRuns.map((run) => run.jobId)),
    );

    for (const enrollment of active) {
      await tx.sequenceStepRun.updateMany({
        where: {
          enrollmentId: enrollment.id,
          status: {
            in: [
              StepRunStatus.pending,
              StepRunStatus.scheduled,
              StepRunStatus.processing,
            ],
          },
        },
        data: {
          status: StepRunStatus.cancelled,
          finishedAt: new Date(),
          lastError: reason,
        },
      });
      await tx.sequenceEnrollment.update({
        where: { id: enrollment.id },
        data: {
          status: EnrollmentStatus.cancelled,
          cancelledAt: new Date(),
          cancelReason: reason,
        },
      });
    }
    return active.length;
  }

  /**
   * Cancela enrollments activos del lead y elimina jobs BullMQ pendientes.
   */
  async stopActiveForLead(leadId: string, reason: string): Promise<number> {
    const active = await this.prisma.sequenceEnrollment.findMany({
      where: { leadId, status: EnrollmentStatus.active },
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
        },
      },
    });

    if (active.length === 0) {
      return 0;
    }

    let stopped = 0;
    for (const enrollment of active) {
      const jobIds = enrollment.stepRuns.map((r) => r.jobId);
      await this.scheduler.cancelJobs(jobIds);

      await this.prisma.$transaction([
        this.prisma.sequenceStepRun.updateMany({
          where: {
            enrollmentId: enrollment.id,
            status: {
              in: [
                StepRunStatus.pending,
                StepRunStatus.scheduled,
                StepRunStatus.processing,
              ],
            },
          },
          data: {
            status: StepRunStatus.cancelled,
            finishedAt: new Date(),
            lastError: reason,
          },
        }),
        this.prisma.sequenceEnrollment.update({
          where: { id: enrollment.id },
          data: {
            status: EnrollmentStatus.cancelled,
            cancelledAt: new Date(),
            cancelReason: reason,
          },
        }),
      ]);

      stopped += 1;
      this.logger.log(
        `Stopped enrollment=${enrollment.id} lead=${leadId} reason=${reason}`,
      );
    }

    return stopped;
  }

  /** Encola la llamada 3 cuando cierra la llamada 2, si aún no está en BullMQ. */
  async scheduleNextFollowup(leadId: string, templateKey: string) {
    return this.scheduler.scheduleFollowupStepIfMissing(leadId, templateKey);
  }

  async cancelEnrollment(
    enrollmentId: string,
    reason = 'manual',
  ): Promise<{ cancelled: boolean }> {
    const enrollment = await this.prisma.sequenceEnrollment.findUnique({
      where: { id: enrollmentId },
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
        },
      },
    });

    if (!enrollment) {
      throw new NotFoundException(`Enrollment ${enrollmentId} not found`);
    }

    if (enrollment.status !== EnrollmentStatus.active) {
      return { cancelled: false };
    }

    await this.scheduler.cancelJobs(enrollment.stepRuns.map((r) => r.jobId));

    await this.prisma.$transaction([
      this.prisma.sequenceStepRun.updateMany({
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
        data: {
          status: StepRunStatus.cancelled,
          finishedAt: new Date(),
          lastError: reason,
        },
      }),
      this.prisma.sequenceEnrollment.update({
        where: { id: enrollmentId },
        data: {
          status: EnrollmentStatus.cancelled,
          cancelledAt: new Date(),
          cancelReason: reason,
        },
      }),
    ]);

    return { cancelled: true };
  }

  /** Expuesto para tests / validación de estado terminal */
  isTerminalStatus(status: LeadStatus | AppLeadStatus): boolean {
    return TERMINAL_LEAD_STATUSES.has(status as AppLeadStatus);
  }
}
