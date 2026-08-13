import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  EnrollmentStatus,
  LeadStatus,
  StepRunStatus,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { LeadStatus as AppLeadStatus, TERMINAL_LEAD_STATUSES } from '../enums';
import { SequenceScheduler } from '../engine/sequence.scheduler';

@Injectable()
export class EnrollmentsService {
  private readonly logger = new Logger(EnrollmentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly scheduler: SequenceScheduler,
  ) {}

  async enrollLead(
    leadId: string,
    sequenceId?: string,
  ): Promise<{ enrollmentId: string; sequenceId: string; stepsScheduled: number }> {
    const lead = await this.prisma.lead.findUnique({ where: { id: leadId } });
    if (!lead) {
      throw new NotFoundException(`Lead ${leadId} not found`);
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

    const existingActive = await this.prisma.sequenceEnrollment.findFirst({
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

    const enrolledAt = new Date();
    const enrollment = await this.prisma.sequenceEnrollment.create({
      data: {
        leadId,
        sequenceId: sequence.id,
        status: EnrollmentStatus.active,
        currentStepOrder: 1,
        enrolledAt,
      },
    });

    await this.scheduler.scheduleEnrollmentSteps(
      enrollment.id,
      leadId,
      sequence.steps,
      enrolledAt,
    );

    this.logger.log(
      `Enrolled lead=${leadId} sequence=${sequence.id} enrollment=${enrollment.id} steps=${sequence.steps.length}`,
    );

    return {
      enrollmentId: enrollment.id,
      sequenceId: sequence.id,
      stepsScheduled: sequence.steps.length,
    };
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
