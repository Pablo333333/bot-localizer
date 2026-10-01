import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  EnrollmentStatus,
  LeadStatus,
  Prisma,
  StepRunStatus,
} from '@prisma/client';
import { Job } from 'bullmq';
import { PrismaService } from '../../prisma/prisma.service';
import { SheetsService } from '../../sheets/sheets.service';
import { NURTURING_STEPS_QUEUE } from '../../queue/queue.constants';
import { EnrollmentsService } from '../enrollments/enrollments.service';
import { alreadyHandledAdReason } from './already-handled-ad';
import { ChannelRegistry } from '../channels/channel.registry';
import { LeadStatus as AppLeadStatus, TERMINAL_LEAD_STATUSES } from '../enums';
import {
  NURTURING_PHASE3_DISABLED_LOG,
  isNurturingPhase3Enabled,
} from '../phase3-enabled';
import {
  PHASE3_LEAD_NOT_ALLOWED_LOG,
  isPhase3AllowedPhone,
} from '../phase3-allowlist';
import { NurturingStepJobData } from './nurturing-step.job';
import { lockPhase3Key } from './pg-advisory-lock';
import {
  isDuplicateCallStep,
  sequenceHasUnfinishedStep,
} from './sequence-step-guard';

@Processor(NURTURING_STEPS_QUEUE, { concurrency: 1 })
export class SequenceProcessor extends WorkerHost {
  private readonly logger = new Logger(SequenceProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly channels: ChannelRegistry,
    private readonly config: ConfigService,
    private readonly sheets: SheetsService,
    private readonly enrollments: EnrollmentsService,
  ) {
    super();
  }

  async process(job: Job<NurturingStepJobData>): Promise<{ status: string }> {
    if (
      !isNurturingPhase3Enabled(this.config.get('NURTURING_PHASE3_ENABLED'))
    ) {
      this.logger.log(NURTURING_PHASE3_DISABLED_LOG);
      return { status: 'disabled' };
    }

    const { stepRunId, enrollmentId, leadId } = job.data;
    this.logger.log(
      `[FASE3][COLA] ejecutando job=${job.id} stepRun=${stepRunId} attempt=${job.attemptsMade + 1} lead=${leadId} enrollment=${enrollmentId}`,
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
      stepRun.status === StepRunStatus.skipped ||
      stepRun.status === StepRunStatus.failed
    ) {
      this.logger.log(
        `[FASE3][COLA] stepRun=${stepRunId} ya cerrado status=${stepRun.status} — no se relanza`,
      );
      return { status: stepRun.status };
    }

    const claim = await this.claimStepRun(stepRun, job.attemptsMade);
    if (claim !== 'claimed') {
      if (claim === 'duplicate' || claim === 'skipped') {
        await this.maybeCompleteEnrollment(enrollmentId);
      }
      return { status: claim };
    }

    const { enrollment } = stepRun;
    const lead = enrollment.lead;

    if (
      !isPhase3AllowedPhone(
        lead.phone,
        this.config.get('NURTURING_PHASE3_PHONE_ALLOWLIST'),
      )
    ) {
      this.logger.warn(
        `${PHASE3_LEAD_NOT_ALLOWED_LOG} — skip stepRun=${stepRunId} phone=${lead.phone}`,
      );
      await this.markSkipped(stepRunId, 'phase3_allowlist');
      await this.maybeCompleteEnrollment(enrollmentId);
      return { status: 'skipped' };
    }

    if (enrollment.status !== EnrollmentStatus.active) {
      await this.markSkipped(stepRunId, `enrollment_${enrollment.status}`);
      return { status: 'skipped' };
    }

    if (this.isTerminal(lead.status)) {
      await this.markSkipped(stepRunId, `lead_status:${lead.status}`);
      return { status: 'skipped' };
    }

    const handled = await this.stopIfAdAlreadyHandled(lead);
    if (handled) {
      return { status: 'skipped' };
    }

    if (lead.id !== leadId && leadId) {
      this.logger.warn(
        `Job leadId mismatch (job=${leadId}, db=${lead.id}) — using DB lead`,
      );
    }

    const adapter = this.channels.get(stepRun.step.channel);
    const templatePayload = (stepRun.step.templatePayload ?? {}) as Record<
      string,
      unknown
    >;

    this.logger.log(
      `[FASE3][COLA] disparando channel=${stepRun.step.channel} template=${stepRun.step.templateKey} lead=${lead.id} phone=${lead.phone} stepRun=${stepRunId}`,
    );

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
    this.logger.log(
      `[FASE3][COLA] paso enviado stepRun=${stepRunId} channel=${stepRun.step.channel} template=${stepRun.step.templateKey} lead=${lead.id} providerRef=${result.providerRef || '?'}`,
    );
    return { status: 'sent' };
  }

  /**
   * Un solo worker puede tomar el paso. Si otro job del mismo lead y plantilla
   * ya está llamando o acaba de llamar, este se omite y no cierra el enrollment ganador.
   */
  private async claimStepRun(
    stepRun: {
      id: string;
      status: StepRunStatus;
      enrollmentId: string;
      startedAt: Date | null;
      step: { templateKey: string };
      enrollment: { leadId: string };
    },
    attemptsMade: number,
  ): Promise<'claimed' | 'duplicate' | 'processing' | 'missing' | 'skipped' | StepRunStatus> {
    const leadId = stepRun.enrollment.leadId;
    const templateKey = stepRun.step.templateKey;
    const retry = attemptsMade > 0 && stepRun.status === StepRunStatus.processing;

    return this.prisma.$transaction(async (tx) => {
      await lockPhase3Key(tx, `fase3-dial:${leadId}:${templateKey}`);

      const current = await tx.sequenceStepRun.findUnique({
        where: { id: stepRun.id },
      });
      if (!current) return 'missing';

      if (
        current.status === StepRunStatus.cancelled ||
        current.status === StepRunStatus.sent ||
        current.status === StepRunStatus.skipped ||
        current.status === StepRunStatus.failed
      ) {
        return current.status;
      }

      if (current.status === StepRunStatus.processing && !retry) {
        this.logger.warn(
          `[FASE3][COLA] stepRun=${stepRun.id} ya está processing — no se dispara otra vez`,
        );
        return 'processing';
      }

      const enrollment = await tx.sequenceEnrollment.findUnique({
        where: { id: stepRun.enrollmentId },
      });
      if (!enrollment || enrollment.status !== EnrollmentStatus.active) {
        await tx.sequenceStepRun.update({
          where: { id: stepRun.id },
          data: {
            status: StepRunStatus.skipped,
            finishedAt: new Date(),
            lastError: `enrollment_${enrollment?.status ?? 'missing'}`,
          },
        });
        return 'skipped';
      }

      const siblings = await tx.sequenceStepRun.findMany({
        where: {
          id: { not: stepRun.id },
          step: { templateKey },
          enrollment: { leadId },
          status: { in: [StepRunStatus.processing, StepRunStatus.sent] },
        },
        select: {
          id: true,
          status: true,
          startedAt: true,
          enrollmentId: true,
        },
      });
      const duplicate = siblings.find((other) =>
        isDuplicateCallStep({
          otherStatus: other.status,
          otherStartedAt: other.startedAt,
        }),
      );
      if (duplicate) {
        await tx.sequenceStepRun.update({
          where: { id: stepRun.id },
          data: {
            status: StepRunStatus.skipped,
            finishedAt: new Date(),
            lastError: `duplicate_call_step:${duplicate.id}`,
          },
        });
        if (duplicate.enrollmentId !== stepRun.enrollmentId) {
          await tx.sequenceEnrollment.updateMany({
            where: {
              id: stepRun.enrollmentId,
              status: EnrollmentStatus.active,
            },
            data: {
              status: EnrollmentStatus.cancelled,
              cancelledAt: new Date(),
              cancelReason: 'duplicate_call_step',
            },
          });
        }
        this.logger.warn(
          `[FASE3][COLA] llamada duplicada omitida stepRun=${stepRun.id} ` +
            `template=${templateKey} lead=${leadId} ya cubierto por stepRun=${duplicate.id} ` +
            `status=${duplicate.status}`,
        );
        return 'duplicate';
      }

      await tx.sequenceStepRun.update({
        where: { id: stepRun.id },
        data: {
          status: StepRunStatus.processing,
          startedAt: current.startedAt ?? new Date(),
          attempts: { increment: 1 },
        },
      });
      return 'claimed';
    });
  }

  /**
   * Si Toni ya habló y dejó el anuncio creado (SI o WP Post ID),
   * cancela la secuencia antes de disparar el paso. No sale otra llamada.
   */
  private async stopIfAdAlreadyHandled(lead: {
    id: string;
    phone: string;
  }): Promise<string | null> {
    try {
      const located = await this.sheets.findLocalizadosRowByPhone(lead.phone);
      if (!located) return null;
      const reason = alreadyHandledAdReason(
        located.row,
        located.sheet.headerValues,
      );
      if (!reason) return null;
      const stopped = await this.enrollments.stopActiveForLead(
        lead.id,
        `anuncio_ya_gestionado:${reason}`,
      );
      this.logger.log(
        `[FASE3][COLA] anuncio ya gestionado (${reason}) lead=${lead.id} phone=${lead.phone} secuencias_paradas=${stopped} — no se llama`,
      );
      return reason;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `[FASE3][COLA] no se pudo comprobar si el anuncio ya está gestionado lead=${lead.id}: ${message}`,
      );
      return null;
    }
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
    const enrollment = await this.prisma.sequenceEnrollment.findUnique({
      where: { id: enrollmentId },
      include: {
        sequence: { include: { steps: true } },
        stepRuns: true,
      },
    });
    if (!enrollment || enrollment.status !== EnrollmentStatus.active) return;

    if (
      sequenceHasUnfinishedStep({
        steps: enrollment.sequence.steps,
        runs: enrollment.stepRuns,
      })
    ) {
      this.logger.log(
        `[FASE3][BULLMQ] enrollment=${enrollmentId} sigue activo: queda un paso sin cerrar (la llamada 3 se encola al terminar la llamada 2)`,
      );
      return;
    }

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
