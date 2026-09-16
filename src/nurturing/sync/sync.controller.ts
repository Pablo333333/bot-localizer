import { Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NurturingApiKeyGuard } from '../guards/nurturing-api-key.guard';
import { SequenceScheduler } from '../engine/sequence.scheduler';
import { EnrollmentsService } from '../enrollments/enrollments.service';
import { PrismaService } from '../../prisma/prisma.service';
import { isNurturingPhase3Enabled } from '../phase3-enabled';
import {
  PHASE3_TONI_PHONE_E164,
  isPhase3AllowedPhone,
  resolvePhase3PhoneAllowlist,
} from '../phase3-allowlist';
import {
  OUTBOUND_SANDBOX_WHITELIST_E164,
  OUTBOUND_SANDBOX_WHITELIST_ENABLED,
} from '../../outbound/outbound-sandbox-whitelist';
import { SheetsLeadSyncService } from './sheets-lead-sync.service';
import { SheetsReviewedSyncService } from './sheets-reviewed-sync.service';

@Controller('nurturing/sync')
@UseGuards(NurturingApiKeyGuard)
export class SyncController {
  constructor(
    private readonly sheetsSync: SheetsLeadSyncService,
    private readonly sheetsReviewedSync: SheetsReviewedSyncService,
    private readonly sequenceScheduler: SequenceScheduler,
    private readonly enrollments: EnrollmentsService,
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  @Post('sheets')
  ingestFromSheets() {
    return this.sheetsSync.ingestFromSheets();
  }

  /**
   * @deprecated Usar POST /nurturing/sync/reviewed-to-wordpress
   * (SheetsWordpressSyncService desactivado — única vía: Anuncio Revisado? = SI).
   */
  @Post('sheets-to-wordpress')
  syncSheetsToWordpress(@Query('row') row?: string) {
    const rowNumber = row ? Number.parseInt(row, 10) : undefined;
    return this.sheetsReviewedSync.syncReviewedRowsToWordpress(
      Number.isFinite(rowNumber) ? rowNumber : undefined,
    );
  }

  /**
   * Anuncio Revisado? = SI → crear/actualizar estate_property en WordPress.
   * Query opcional: ?row=42 (número de fila del Sheet, 1-based con cabecera en fila 1).
   */
  @Post('reviewed-to-wordpress')
  syncReviewedToWordpress(@Query('row') row?: string) {
    const rowNumber = row ? Number.parseInt(row, 10) : undefined;
    return this.sheetsReviewedSync.syncReviewedRowsToWordpress(
      Number.isFinite(rowNumber) ? rowNumber : undefined,
    );
  }

  /**
   * Reprocesa los estate_property de prueba de Toni (o ?ids=33595,33597).
   * Por defecto NO pisa anuncios ya publicados (protección).
   * ?force=1 autoriza sobrescritura (o celda Sheet "Forzar sync WP"=SI).
   */
  @Post('toni-test-properties')
  syncToniTestProperties(
    @Query('ids') ids?: string,
    @Query('force') force?: string,
  ) {
    const parsed = String(ids || '')
      .split(',')
      .map((v) => Number.parseInt(v.trim(), 10))
      .filter((n) => Number.isFinite(n));
    const forceSync = ['1', 'true', 'yes', 'si', 'sí'].includes(
      String(force || '')
        .trim()
        .toLowerCase(),
    );
    return this.sheetsReviewedSync.syncWordpressPostsByIds(
      parsed.length ? parsed : undefined,
      { force: forceSync },
    );
  }

  @Get('health')
  async health() {
    const phase3Raw = this.config.get('NURTURING_PHASE3_ENABLED');
    const defaultSequence = await this.prisma.sequence.findFirst({
      where: { isDefault: true, isActive: true },
      include: { _count: { select: { steps: true } } },
    });
    const toniDigits = '644408099';
    const toniLead = await this.prisma.lead.findFirst({
      where: { phone: { contains: toniDigits } },
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        phone: true,
        status: true,
        metadata: true,
        updatedAt: true,
      },
    });

    return {
      ok: true,
      service: 'nurturing-sync',
      runtime: {
        phase3Enabled: isNurturingPhase3Enabled(phase3Raw),
        phase3Raw: phase3Raw == null ? null : String(phase3Raw),
        phase3PhoneAllowlist: resolvePhase3PhoneAllowlist(
          this.config.get('NURTURING_PHASE3_PHONE_ALLOWLIST'),
        ),
        phase3ToniOnlyDefault: PHASE3_TONI_PHONE_E164,
        sandboxWhitelistEnabled: OUTBOUND_SANDBOX_WHITELIST_ENABLED,
        sandboxWhitelistE164: OUTBOUND_SANDBOX_WHITELIST_E164,
        t0Channel: String(this.config.get('NURTURING_T0_CHANNEL') ?? 'sms'),
        whatsappEnabled: String(
          this.config.get('NURTURING_WHATSAPP_ENABLED') ?? 'false',
        ),
        outboundAgentId: this.config.get('RETELL_OUTBOUND_AGENT_ID') || null,
        followupAgentId:
          this.config.get('RETELL_AGENT_ID_FOLLOWUP') ||
          'agent_25c341a3bcc06e505b5ed2850c',
        redisUrlConfigured: Boolean(this.config.get('REDIS_URL')),
        defaultSequence: defaultSequence
          ? {
              id: defaultSequence.id,
              name: defaultSequence.name,
              steps: defaultSequence._count.steps,
            }
          : null,
        toniLead: toniLead
          ? {
              id: toniLead.id,
              phone: toniLead.phone,
              status: toniLead.status,
              updatedAt: toniLead.updatedAt,
              metadata: toniLead.metadata,
            }
          : null,
        checkedAt: new Date().toISOString(),
      },
    };
  }

  /**
   * Enroll manual Fase 3 — solo teléfonos de la allowlist (Toni por defecto).
   * POST /nurturing/sync/enroll-phone?phone=644408099
   */
  @Post('enroll-phone')
  async enrollPhone(@Query('phone') phone?: string) {
    const raw = String(phone || PHASE3_TONI_PHONE_E164).trim();
    if (
      !isPhase3AllowedPhone(
        raw,
        this.config.get('NURTURING_PHASE3_PHONE_ALLOWLIST'),
      )
    ) {
      return {
        ok: false,
        error: `Fase 3 solo allowlist (default Toni ${PHASE3_TONI_PHONE_E164})`,
      };
    }
    const digits = raw.replace(/\D/g, '').slice(-9);
    let lead = await this.prisma.lead.findFirst({
      where: { phone: { contains: digits } },
      orderBy: { updatedAt: 'desc' },
    });
    if (!lead) {
      lead = await this.prisma.lead.create({
        data: {
          phone: raw.startsWith('+') ? raw : `+34${digits}`,
          name: 'Toni (enroll manual)',
          source: 'manual_enroll_test',
        },
      });
    }
    try {
      const result = await this.enrollments.enrollLead(lead.id);
      return { ok: true, leadId: lead.id, ...result };
    } catch (err) {
      return {
        ok: false,
        leadId: lead.id,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /**
   * Inspección BullMQ/Prisma: delayed + waiting/active/failed + stepRuns.
   * GET /nurturing/sync/queue-jobs
   * GET /nurturing/sync/queue-jobs?phone=644408099
   */
  @Get('queue-jobs')
  inspectQueueJobs(@Query('phone') phone?: string) {
    return this.sequenceScheduler.inspectScheduledJobs(phone);
  }
}
