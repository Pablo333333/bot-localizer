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
import { XService } from './x.service';

@Controller('x')
export class XController {
  private readonly logger = new Logger(XController.name);

  constructor(
    private readonly xService: XService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Verificación CRC Account Activity API.
   * GET /x/webhook?crc_token=...
   */
  @Get('webhook')
  verifyWebhook(
    @Query('crc_token') crcToken: string,
    @Res() res: Response,
  ) {
    const responseToken = this.xService.verifyCrc(crcToken);
    if (!responseToken) {
      this.logger.warn(
        'X webhook CRC: falta crc_token o X_API_SECRET / X_CONSUMER_SECRET',
      );
      return res.status(HttpStatus.FORBIDDEN).send('Forbidden');
    }

    this.logger.log('X webhook CRC verificado OK');
    return res.status(HttpStatus.OK).json({ response_token: responseToken });
  }

  /**
   * Eventos Account Activity (DMs). Ack 200; auto-reply Localisto si está activo.
   * No procesa tweets ni menciones públicas.
   */
  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  async handleWebhook(@Body() body: Record<string, unknown>) {
    const dmCount = Array.isArray(body?.direct_message_events)
      ? body.direct_message_events.length
      : Array.isArray(body?.dm_events)
        ? body.dm_events.length
        : 0;

    this.logger.log(`X webhook event dmEvents=${dmCount}`);
    this.logger.debug(`X webhook payload keys=${Object.keys(body || {}).join(',')}`);

    try {
      await this.xService.handleIncomingDm(body);
    } catch (err) {
      this.logger.error(
        `X webhook error: ${err instanceof Error ? err.message : err}`,
      );
    }

    return { status: 'ok' };
  }

  /** Health / diagnóstico de credenciales (sin secretos). */
  @Get('health')
  health() {
    const creds = this.xService.getCredentials();
    return {
      ok: true,
      service: 'x-dm',
      credentialsConfigured: Boolean(creds),
      agentIdConfigured: Boolean(
        this.config.get<string>('X_AGENT_ID')?.trim(),
      ),
    };
  }
}
