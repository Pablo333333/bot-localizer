import { Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { NurturingApiKeyGuard } from '../guards/nurturing-api-key.guard';
import { SheetsLeadSyncService } from './sheets-lead-sync.service';
import { SheetsWordpressSyncService } from './sheets-wordpress-sync.service';

@Controller('nurturing/sync')
@UseGuards(NurturingApiKeyGuard)
export class SyncController {
  constructor(
    private readonly sheetsSync: SheetsLeadSyncService,
    private readonly sheetsWpSync: SheetsWordpressSyncService,
  ) {}

  @Post('sheets')
  ingestFromSheets() {
    return this.sheetsSync.ingestFromSheets();
  }

  /** Sync Sheets → WordPress (filas con columna "WP Post ID") */
  @Post('sheets-to-wordpress')
  syncSheetsToWordpress() {
    return this.sheetsWpSync.syncSheetRowsToWordpress();
  }

  @Get('health')
  health() {
    return { ok: true, service: 'nurturing-sync' };
  }
}
