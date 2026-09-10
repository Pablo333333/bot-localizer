import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { XChatService } from './x-chat.service';
import { XService } from './x.service';

@Controller('x')
export class XController {
  private readonly logger = new Logger(XController.name);

  constructor(
    private readonly xService: XService,
    private readonly xChat: XChatService,
    private readonly config: ConfigService,
  ) {}

  /**
   * CRC challenge Account Activity API (X/Twitter).
   * GET /x/webhook?crc_token=...
   * Respuesta exacta: { "response_token": "sha256=<base64>" }
   * @see https://developer.x.com/en/docs/twitter-api/enterprise/account-activity-api/guides/securing-webhooks
   */
  @Get('webhook')
  verifyWebhook(
    @Query('crc_token') crcToken: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const token =
      (typeof crcToken === 'string' && crcToken) ||
      (typeof req.query.crc_token === 'string' ? req.query.crc_token : '') ||
      '';

    if (!token) {
      this.logger.warn('X webhook CRC: falta query crc_token');
      return res.status(HttpStatus.BAD_REQUEST).json({
        error: 'missing_crc_token',
      });
    }

    const responseToken = this.xService.verifyCrc(token);
    if (!responseToken) {
      this.logger.warn(
        'X webhook CRC: falta X_API_SECRET / X_CONSUMER_SECRET en el entorno',
      );
      return res.status(HttpStatus.FORBIDDEN).send('Forbidden');
    }

    this.logger.log(
      `X webhook CRC OK (tokenLen=${token.length} responsePrefix=${responseToken.slice(0, 12)}…)`,
    );

    // Spec X: 200 + application/json + únicamente response_token
    res.status(HttpStatus.OK);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    return res.send(JSON.stringify({ response_token: responseToken }));
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
    this.logger.debug(
      `X webhook payload keys=${Object.keys(body || {}).join(',')}`,
    );

    try {
      await this.xService.handleIncomingDm(body);
    } catch (err) {
      this.logger.error(
        `X webhook error: ${err instanceof Error ? err.message : err}`,
      );
    }

    return { status: 'ok' };
  }

  /**
   * Exporta el System Prompt de DMs (fuente: Config_X!B2).
   * GET /x/prompt
   */
  @Get('prompt')
  async getPrompt() {
    return this.xChat.getSystemPromptForAudit();
  }

  /** Health / diagnóstico de credenciales (sin secretos). */
  @Get('health')
  async health() {
    const creds = this.xService.getCredentials();
    const secretConfigured = Boolean(
      this.config.get<string>('X_API_SECRET') ||
        this.config.get<string>('X_CONSUMER_SECRET'),
    );
    return {
      ok: true,
      service: 'x-dm',
      credentialsConfigured: Boolean(creds),
      crcSecretConfigured: secretConfigured,
      agentIdConfigured: Boolean(this.config.get<string>('X_AGENT_ID')?.trim()),
      prompt: await this.xChat.getSystemPromptForAudit(),
      webhookUrlHint: 'GET|POST /x/webhook',
    };
  }
}
