import { Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NurturingApiKeyGuard } from '../guards/nurturing-api-key.guard';
import { SequenceScheduler } from '../engine/sequence.scheduler';
import {
  isNurturingPhase3Enabled,
} from '../phase3-enabled';
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
  health() {
    const phase3Raw = this.config.get('NURTURING_PHASE3_ENABLED');
    return {
      ok: true,
      service: 'nurturing-sync',
      /** Lo que el proceso realmente ve tras el redeploy (no el panel de Railway). */
      runtime: {
        phase3Enabled: isNurturingPhase3Enabled(phase3Raw),
        phase3Raw: phase3Raw == null ? null : String(phase3Raw),
        sandboxWhitelistEnabled: OUTBOUND_SANDBOX_WHITELIST_ENABLED,
        sandboxWhitelistE164: OUTBOUND_SANDBOX_WHITELIST_E164,
        t0Channel: String(this.config.get('NURTURING_T0_CHANNEL') ?? 'sms'),
        whatsappEnabled: String(
          this.config.get('NURTURING_WHATSAPP_ENABLED') ?? 'false',
        ),
        outboundAgentIdConfigured: Boolean(
          this.config.get('RETELL_OUTBOUND_AGENT_ID'),
        ),
        followupAgentId:
          this.config.get('RETELL_AGENT_ID_FOLLOWUP') ||
          'agent_25c341a3bcc06e505b5ed2850c',
        redisUrlConfigured: Boolean(this.config.get('REDIS_URL')),
        checkedAt: new Date().toISOString(),
      },
    };
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

