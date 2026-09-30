import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EnrollmentStatus, SequenceStep, StepRunStatus } from '@prisma/client';
import { Queue } from 'bullmq';
import { PrismaService } from '../../prisma/prisma.service';
import { NURTURING_STEP_JOB, NURTURING_STEPS_QUEUE } from '../../queue/queue.constants';
import {
  NURTURING_PHASE3_DISABLED_LOG,
  isNurturingPhase3Enabled,
} from '../phase3-enabled';
import {
  PHASE3_LEAD_NOT_ALLOWED_LOG,
  isPhase3AllowedPhone,
  resolvePhase3PhoneAllowlist,
  PHASE3_TONI_PHONE_E164,
} from '../phase3-allowlist';
import {
  OUTBOUND_SANDBOX_WHITELIST_E164,
  isOutboundSandboxWhitelistEnabled,
} from '../../outbound/outbound-sandbox-whitelist';
import { lockPhase3Key } from './pg-advisory-lock';
import { NurturingStepJobData, stepRunJobId } from './nurturing-step.job';
import {
  formatMadridDateTime,
  isNurturingFastTest,
  nurturingStepLabel,
  resolveNurturingStepDelayMinutes,
} from '../nurturing-fast-delay';
import {
  TEMPLATE_CALL_FOLLOWUP_D7,
} from '../toni-fase3.constants';

const OPEN_STEP_STATUSES: StepRunStatus[] = [
  StepRunStatus.pending,
  StepRunStatus.scheduled,
  StepRunStatus.processing,
  StepRunStatus.sent,
];

export interface ScheduledFollowupResult {
  status:
    | 'scheduled'
    | 'already_scheduled'
    | 'no_enrollment'
    | 'no_step'
    | 'disabled'
    | 'not_allowed';
  scheduledFor?: string;
  scheduledForMadrid?: string;
  delayMinutes?: number;
  jobId?: string | null;
  stepRunId?: string;
}

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
  ): Promise<number> {
    if (
      !isNurturingPhase3Enabled(this.config.get('NURTURING_PHASE3_ENABLED'))
    ) {
      this.logger.log(NURTURING_PHASE3_DISABLED_LOG);
      return 0;
    }

    const lead = await this.prisma.lead.findUnique({ where: { id: leadId } });
    if (
      !lead ||
      !isPhase3AllowedPhone(
        lead.phone,
        this.config.get('NURTURING_PHASE3_PHONE_ALLOWLIST'),
      )
    ) {
      this.logger.warn(
        `${PHASE3_LEAD_NOT_ALLOWED_LOG} — no se encola BullMQ enrollment=${enrollmentId} lead=${leadId} phone=${lead?.phone ?? '?'}`,
      );
      return 0;
    }

    const fast = isNurturingFastTest(this.config.get('NURTURING_FAST_TEST'));
    const ordered = [...steps].sort((a, b) => a.order - b.order);
    const selected = fast
      ? ordered.filter((step) => step.templateKey === TEMPLATE_CALL_FOLLOWUP_D7)
      : ordered;

    if (fast) {
      const call2Minutes = this.resolveDelayMinutes({
        templateKey: TEMPLATE_CALL_FOLLOWUP_D7,
        delayMinutes: 10_080,
      });
      this.logger.warn(
        `[FASE3][BULLMQ] NURTURING_FAST_TEST activo — llamada 2 en ${call2Minutes} min desde ahora. ` +
          `La llamada 3 no se encola todavía: sale al cerrar la llamada 2.`,
      );
      if (selected.length === 0) {
        this.logger.error(
          `[FASE3][BULLMQ] la secuencia no tiene paso ${TEMPLATE_CALL_FOLLOWUP_D7}; no hay llamada 2 que encolar`,
        );
      }
    }

    let queued = 0;
    for (const step of selected) {
      await this.enqueueStep({
        enrollmentId,
        leadId,
        step,
        baseTime: enrolledAt,
      });
      queued += 1;
    }
    return queued;
  }

  /**
   * Encola la llamada 3 si la llamada 2 ya cerró y ese paso aún no está en cola.
   * En modo rápido el delay cuenta desde ahora (no desde el enroll de la llamada 1).
   */
  async scheduleFollowupStepIfMissing(
    leadId: string,
    templateKey: string,
  ): Promise<ScheduledFollowupResult> {
    if (!isNurturingPhase3Enabled(this.config.get('NURTURING_PHASE3_ENABLED'))) {
      this.logger.log(NURTURING_PHASE3_DISABLED_LOG);
      return { status: 'disabled' };
    }

    const lead = await this.prisma.lead.findUnique({ where: { id: leadId } });
    if (
      !lead ||
      !isPhase3AllowedPhone(
        lead.phone,
        this.config.get('NURTURING_PHASE3_PHONE_ALLOWLIST'),
      )
    ) {
      this.logger.warn(
        `${PHASE3_LEAD_NOT_ALLOWED_LOG} — no se encola ${templateKey} lead=${leadId}`,
      );
      return { status: 'not_allowed' };
    }

    const enrollment = await this.findEnrollmentForFollowup(leadId, templateKey);
    if (!enrollment) {
      this.logger.warn(
        `[FASE3][BULLMQ] no hay enrollment activo para encolar ${templateKey} lead=${leadId}`,
      );
      return { status: 'no_enrollment' };
    }

    const step = enrollment.sequence.steps.find(
      (item) => item.templateKey === templateKey,
    );
    if (!step) {
      this.logger.error(
        `[FASE3][BULLMQ] la secuencia ${enrollment.sequenceId} no tiene template=${templateKey}`,
      );
      return { status: 'no_step' };
    }

    const existing = enrollment.stepRuns.find(
      (run) => run.stepId === step.id && OPEN_STEP_STATUSES.includes(run.status),
    );
    if (existing) {
      this.logger.log(
        `[FASE3][BULLMQ] ${nurturingStepLabel(templateKey)} ya en cola ` +
          `status=${existing.status} scheduledFor=${existing.scheduledFor.toISOString()} ` +
          `madrid=${formatMadridDateTime(existing.scheduledFor)} jobId=${existing.jobId ?? 'n/a'} ` +
          `stepRun=${existing.id} lead=${leadId}`,
      );
      return {
        status: 'already_scheduled',
        scheduledFor: existing.scheduledFor.toISOString(),
        scheduledForMadrid: formatMadridDateTime(existing.scheduledFor),
        jobId: existing.jobId,
        stepRunId: existing.id,
      };
    }

    const queued = await this.enqueueStep({
      enrollmentId: enrollment.id,
      leadId,
      step,
      baseTime: new Date(),
    });
    return {
      status: 'scheduled',
      scheduledFor: queued.scheduledFor.toISOString(),
      scheduledForMadrid: formatMadridDateTime(queued.scheduledFor),
      delayMinutes: queued.delayMinutes,
      jobId: queued.jobId,
      stepRunId: queued.stepRunId,
    };
  }

  /**
   * Enrollment activo, o el último completado si se cerró antes de encolar este paso
   * (la llamada 2 marca `sent` y la 3 todavía no tiene run).
   */
  private async findEnrollmentForFollowup(leadId: string, templateKey: string) {
    const include = {
      sequence: { include: { steps: true } },
      stepRuns: true,
    } as const;

    const active = await this.prisma.sequenceEnrollment.findFirst({
      where: { leadId, status: EnrollmentStatus.active },
      orderBy: { enrolledAt: 'desc' },
      include,
    });
    if (active) return active;

    const latest = await this.prisma.sequenceEnrollment.findFirst({
      where: { leadId, status: EnrollmentStatus.completed },
      orderBy: { enrolledAt: 'desc' },
      include,
    });
    if (!latest) return null;

    const step = latest.sequence.steps.find(
      (item) => item.templateKey === templateKey,
    );
    const alreadyQueued = latest.stepRuns.some(
      (run) =>
        step &&
        run.stepId === step.id &&
        OPEN_STEP_STATUSES.includes(run.status),
    );
    if (!step || alreadyQueued) return null;

    await this.prisma.sequenceEnrollment.update({
      where: { id: latest.id },
      data: { status: EnrollmentStatus.active, completedAt: null },
    });
    this.logger.warn(
      `[FASE3][BULLMQ] enrollment=${latest.id} reactivado para encolar ${nurturingStepLabel(templateKey)} ` +
        `lead=${leadId} (se había cerrado antes de crear ese paso)`,
    );
    return this.prisma.sequenceEnrollment.findFirst({
      where: { id: latest.id },
      include,
    });
  }

  private resolveDelayMinutes(step: {
    templateKey: string;
    delayMinutes: number;
  }): number {
    return resolveNurturingStepDelayMinutes({
      templateKey: step.templateKey,
      storedDelayMinutes: step.delayMinutes,
      fastTestRaw: this.config.get('NURTURING_FAST_TEST'),
      fastT7MinutesRaw: this.config.get('NURTURING_FAST_T7_MINUTES'),
      fastT10MinutesRaw: this.config.get('NURTURING_FAST_T10_MINUTES'),
    });
  }

  private async enqueueStep(params: {
    enrollmentId: string;
    leadId: string;
    step: SequenceStep;
    baseTime: Date;
  }): Promise<{
    stepRunId: string;
    jobId: string;
    scheduledFor: Date;
    delayMinutes: number;
  }> {
    const delayMinutes = this.resolveDelayMinutes(params.step);
    const scheduledFor = new Date(
      params.baseTime.getTime() + delayMinutes * 60_000,
    );

    const reserved = await this.prisma.$transaction(async (tx) => {
      await lockPhase3Key(
        tx,
        `fase3-enqueue:${params.leadId}:${params.step.templateKey}`,
      );
      const existing = await tx.sequenceStepRun.findFirst({
        where: {
          enrollmentId: params.enrollmentId,
          stepId: params.step.id,
          status: { in: OPEN_STEP_STATUSES },
        },
        orderBy: { scheduledFor: 'desc' },
      });
      if (existing) return { existing };
      const stepRun = await tx.sequenceStepRun.create({
        data: {
          enrollmentId: params.enrollmentId,
          stepId: params.step.id,
          status: StepRunStatus.scheduled,
          scheduledFor,
          attempts: 0,
        },
      });
      return { stepRun };
    });

    if (reserved.existing) {
      this.logger.warn(
        `[FASE3][BULLMQ] ${nurturingStepLabel(params.step.templateKey)} ya existe ` +
          `status=${reserved.existing.status} stepRun=${reserved.existing.id} jobId=${reserved.existing.jobId ?? 'n/a'} ` +
          `lead=${params.leadId} enrollment=${params.enrollmentId} — no se encola otro job`,
      );
      return {
        stepRunId: reserved.existing.id,
        jobId: reserved.existing.jobId ?? '',
        scheduledFor: reserved.existing.scheduledFor,
        delayMinutes,
      };
    }

    const delayMs = Math.max(0, scheduledFor.getTime() - Date.now());
    const stepRun = reserved.stepRun;

    const jobId = stepRunJobId(stepRun.id);
    const job = await this.queue.add(
      NURTURING_STEP_JOB,
      {
        stepRunId: stepRun.id,
        enrollmentId: params.enrollmentId,
        leadId: params.leadId,
      },
      {
        jobId,
        delay: delayMs,
        attempts: Math.max(1, params.step.maxRetries),
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
      `[FASE3][BULLMQ] encolado ${nurturingStepLabel(params.step.templateKey)} ` +
        `template=${params.step.templateKey} channel=${params.step.channel} ` +
        `delay=${delayMinutes} min (${delayMs} ms) ` +
        `scheduledFor=${scheduledFor.toISOString()} madrid=${formatMadridDateTime(scheduledFor)} ` +
        `jobId=${job.id ?? jobId} stepRun=${stepRun.id} lead=${params.leadId} enrollment=${params.enrollmentId}`,
    );

    return {
      stepRunId: stepRun.id,
      jobId: String(job.id ?? jobId),
      scheduledFor,
      delayMinutes,
    };
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

  /**
   * Inspección rápida post-llamada: delayed jobs en BullMQ + stepRuns en Prisma.
   * Opcional: filtrar por teléfono del lead.
   *
   * No depende de NURTURING_PHASE3_ENABLED ni de Google Sheets.
   * Errores de Redis/Prisma se capturan y se devuelven en `errors` (HTTP 200)
   * para no ocultar la causa detrás de un 500 genérico.
   */
  async inspectScheduledJobs(phone?: string): Promise<{
    queue: string;
    phoneFilter: string | null;
    digits: string | null;
    phase3Enabled: boolean;
    runtime?: {
      phase3Enabled: boolean;
      phase3Raw: string | null;
      phase3PhoneAllowlist: string[];
      phase3ToniOnlyDefault: string;
      sandboxWhitelistEnabled: boolean;
      sandboxWhitelistE164: string;
    };
    /** Conteos BullMQ (waiting = backlog listo al arrancar worker) */
    jobCounts: Record<string, number> | null;
    lead: {
      id: string;
      phone: string;
      status: string;
      metadata: unknown;
    } | null;
    delayedCount: number;
    delayedJobs: Array<{
      jobId: string | undefined;
      name: string | undefined;
      delayMs: number | undefined;
      delayDays: number | null;
      processAt: string | null;
      data: NurturingStepJobData;
      state: string;
    }>;
    /** waiting / active / failed (además de delayed) — útil tras downtime */
    readyOrFailedJobs: Array<{
      jobId: string | undefined;
      state: string;
      data: NurturingStepJobData;
      failedReason?: string;
    }>;
    stepRuns: Array<{
      id: string;
      status: string;
      scheduledFor: Date;
      scheduledForIso: string;
      delayMinutes: number;
      delayDays: number;
      jobId: string | null;
      templateKey: string;
      label: string;
      leadId: string;
      leadPhone: string;
      overdue: boolean;
    }>;
    errors: {
      redis?: string;
      prismaLead?: string;
      prismaStepRuns?: string;
    };
  }> {
    const digits = phone?.replace(/\D/g, '').slice(-9) || null;
    const errors: {
      redis?: string;
      prismaLead?: string;
      prismaStepRuns?: string;
    } = {};
    let jobCounts: Record<string, number> | null = null;
    let delayedJobs: Array<{
      jobId: string | undefined;
      name: string | undefined;
      delayMs: number | undefined;
      delayDays: number | null;
      processAt: string | null;
      data: NurturingStepJobData;
      state: string;
    }> = [];
    let readyOrFailedJobs: Array<{
      jobId: string | undefined;
      state: string;
      data: NurturingStepJobData;
      failedReason?: string;
    }> = [];
    let lead: {
      id: string;
      phone: string;
      status: string;
      metadata: unknown;
    } | null = null;
    let stepRunsMapped: Array<{
      id: string;
      status: string;
      scheduledFor: Date;
      scheduledForIso: string;
      delayMinutes: number;
      delayDays: number;
      jobId: string | null;
      templateKey: string;
      label: string;
      leadId: string;
      leadPhone: string;
      overdue: boolean;
    }> = [];

    // 1) BullMQ / Redis — causa más frecuente de 500 si REDIS_URL falla en runtime
    try {
      jobCounts = await this.queue.getJobCounts(
        'waiting',
        'delayed',
        'active',
        'failed',
        'completed',
        'paused',
        'prioritized',
      );
      const delayed = await this.queue.getJobs(['delayed'], 0, 49);
      delayedJobs = await Promise.all(
        delayed.map(async (job) => {
          const state = await job.getState();
          const delayMs = job.opts.delay;
          const processAt =
            delayMs != null
              ? new Date((job.timestamp || Date.now()) + delayMs).toISOString()
              : null;
          return {
            jobId: job.id,
            name: job.name,
            delayMs,
            delayDays:
              delayMs != null
                ? Math.round(delayMs / (24 * 60 * 60_000) * 10) / 10
                : null,
            processAt,
            data: job.data,
            state,
          };
        }),
      );
      const ready = await this.queue.getJobs(
        ['waiting', 'active', 'failed', 'prioritized'],
        0,
        49,
      );
      readyOrFailedJobs = await Promise.all(
        ready.map(async (job) => {
          const state = await job.getState();
          return {
            jobId: job.id,
            state,
            data: job.data,
            failedReason:
              state === 'failed'
                ? String(job.failedReason || '').slice(0, 200)
                : undefined,
          };
        }),
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.redis = msg;
      this.logger.error(
        `inspectScheduledJobs Redis/BullMQ failed: ${msg}`,
        err instanceof Error ? err.stack : undefined,
      );
    }

    // 2) Lead en Postgres (no Sheets)
    if (digits) {
      try {
        const row = await this.prisma.lead.findFirst({
          where: { phone: { contains: digits } },
          orderBy: { updatedAt: 'desc' },
        });
        if (row) {
          lead = {
            id: row.id,
            phone: row.phone,
            status: row.status,
            metadata: row.metadata,
          };
          delayedJobs = delayedJobs.filter((j) => j.data?.leadId === row.id);
          readyOrFailedJobs = readyOrFailedJobs.filter(
            (j) => j.data?.leadId === row.id,
          );
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.prismaLead = msg;
        this.logger.error(
          `inspectScheduledJobs prisma.lead failed: ${msg}`,
          err instanceof Error ? err.stack : undefined,
        );
      }
    }

    // 3) StepRuns programados
    try {
      const stepRuns = await this.prisma.sequenceStepRun.findMany({
        where: {
          status: { in: [StepRunStatus.scheduled, StepRunStatus.pending] },
          ...(digits
            ? {
                enrollment: {
                  lead: { phone: { contains: digits } },
                },
              }
            : {}),
        },
        include: {
          step: true,
          enrollment: { include: { lead: true } },
        },
        orderBy: { scheduledFor: 'asc' },
        take: 50,
      });

      const now = Date.now();
      stepRunsMapped = stepRuns.map((r) => {
        const days = Math.round((r.step.delayMinutes / (24 * 60)) * 10) / 10;
        const label =
          r.step.templateKey.includes('d7') || r.step.delayMinutes === 10_080
            ? 'T+7'
            : r.step.templateKey.includes('d10') ||
                r.step.delayMinutes === 14_400
              ? 'T+10'
              : `T+${days}d`;
        return {
          id: r.id,
          status: r.status,
          scheduledFor: r.scheduledFor,
          scheduledForIso: r.scheduledFor.toISOString(),
          delayMinutes: r.step.delayMinutes,
          delayDays: days,
          jobId: r.jobId,
          templateKey: r.step.templateKey,
          label,
          leadId: r.enrollment.leadId,
          leadPhone: r.enrollment.lead.phone,
          overdue: r.scheduledFor.getTime() <= now,
        };
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.prismaStepRuns = msg;
      this.logger.error(
        `inspectScheduledJobs prisma.sequenceStepRun failed: ${msg}`,
        err instanceof Error ? err.stack : undefined,
      );
    }

    return {
      queue: NURTURING_STEPS_QUEUE,
      phoneFilter: phone?.trim() || null,
      digits,
      phase3Enabled: isNurturingPhase3Enabled(
        this.config.get('NURTURING_PHASE3_ENABLED'),
      ),
      jobCounts,
      /** Eco de runtime: confirma si el proceso cargó NURTURING_PHASE3_ENABLED */
      runtime: {
        phase3Enabled: isNurturingPhase3Enabled(
          this.config.get('NURTURING_PHASE3_ENABLED'),
        ),
        phase3Raw:
          this.config.get('NURTURING_PHASE3_ENABLED') == null
            ? null
            : String(this.config.get('NURTURING_PHASE3_ENABLED')),
        phase3PhoneAllowlist: resolvePhase3PhoneAllowlist(
          this.config.get('NURTURING_PHASE3_PHONE_ALLOWLIST'),
        ),
        phase3ToniOnlyDefault: PHASE3_TONI_PHONE_E164,
        sandboxWhitelistEnabled: isOutboundSandboxWhitelistEnabled(
          this.config.get('OUTBOUND_SANDBOX_WHITELIST_ENABLED'),
        ),
        sandboxWhitelistE164: OUTBOUND_SANDBOX_WHITELIST_E164,
      },
      lead,
      delayedCount: delayedJobs.length,
      delayedJobs,
      readyOrFailedJobs,
      stepRuns: stepRunsMapped,
      errors,
    };
  }
}
