import { Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { NurturingApiKeyGuard } from '../guards/nurturing-api-key.guard';
import { SequenceScheduler } from '../engine/sequence.scheduler';
import { SheetsLeadSyncService } from './sheets-lead-sync.service';
import { SheetsReviewedSyncService } from './sheets-reviewed-sync.service';

@Controller('nurturing/sync')
@UseGuards(NurturingApiKeyGuard)
export class SyncController {
  constructor(
    private readonly sheetsSync: SheetsLeadSyncService,
    private readonly sheetsReviewedSync: SheetsReviewedSyncService,
    private readonly sequenceScheduler: SequenceScheduler,
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
    return { ok: true, service: 'nurturing-sync' };
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

