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
import {
  PHASE3_LEAD_NOT_ALLOWED_LOG,
  isPhase3AllowedPhone,
  resolvePhase3PhoneAllowlist,
  PHASE3_TONI_PHONE_E164,
} from '../phase3-allowlist';
import {
  OUTBOUND_SANDBOX_WHITELIST_E164,
  OUTBOUND_SANDBOX_WHITELIST_ENABLED,
} from '../../outbound/outbound-sandbox-whitelist';
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
        sandboxWhitelistEnabled: OUTBOUND_SANDBOX_WHITELIST_ENABLED,
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
