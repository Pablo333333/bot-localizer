import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import { MetaService } from './meta.service';

@Controller('meta')
export class MetaController {
  private readonly logger = new Logger(MetaController.name);

  constructor(
    private readonly metaService: MetaService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Verificación inicial del Webhook (Meta Graph API).
   * GET /meta/webhook?hub.mode=subscribe&hub.verify_token=...&hub.challenge=...
   */
  @Get('webhook')
  verifyWebhook(
    @Query('hub.mode') mode: string,
    @Query('hub.verify_token') verifyToken: string,
    @Query('hub.challenge') challenge: string,
    @Res() res: Response,
  ) {
    const expected = this.config.get<string>('META_VERIFY_TOKEN');

    if (mode === 'subscribe' && expected && verifyToken === expected) {
      this.logger.log('Meta webhook verificado OK');
      return res.status(HttpStatus.OK).send(challenge);
    }

    this.logger.warn(
      `Meta webhook verificación fallida (mode=${mode}, tokenMatch=${Boolean(expected && verifyToken === expected)})`,
    );
    return res.status(HttpStatus.FORBIDDEN).send('Forbidden');
  }

  /**
   * Notificaciones Messenger / Instagram DM.
   * Ack 200 inmediato. Auto-reply Localisto OFF por defecto (GHL).
   */
  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  async handleWebhook(@Body() body: Record<string, unknown>) {
    const objectType = body?.object ?? 'unknown';
    const entryCount = Array.isArray(body?.entry) ? body.entry.length : 0;

    this.logger.log(
      `Meta webhook event object=${objectType} entries=${entryCount}`,
    );
    this.logger.debug(`Meta webhook payload: ${JSON.stringify(body)}`);

    try {
      await this.metaService.handleIncomingMessage(body);
    } catch (err) {
      this.logger.error(
        `Error procesando evento Meta: ${err instanceof Error ? err.message : err}`,
      );
    }

    return { status: 'ok' };
  }
}
