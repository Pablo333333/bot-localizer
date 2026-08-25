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
   * Stub de verificación CRC / challenge (Account Activity API).
   * GET /x/webhook?crc_token=...
   */
  @Get('webhook')
  verifyWebhook(
    @Query('crc_token') crcToken: string,
    @Res() res: Response,
  ) {
    const consumerSecret = this.config.get<string>('X_CONSUMER_SECRET');
    if (!crcToken || !consumerSecret) {
      this.logger.warn('X webhook verify: falta crc_token o X_CONSUMER_SECRET');
      return res.status(HttpStatus.FORBIDDEN).send('Forbidden');
    }

    // Stub: devolver eco del token (firma HMAC real pendiente)
    this.logger.log('[STUB X] webhook CRC verification passthrough');
    return res.status(HttpStatus.OK).json({
      response_token: `sha256=STUB_${crcToken}`,
      stub: true,
    });
  }

  /** Recibe eventos DM; ack 200 sin auto-reply. */
  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  async handleWebhook(@Body() body: Record<string, unknown>) {
    this.logger.log('X webhook event received (stub, no auto-reply)');
    try {
      await this.xService.handleIncomingDm(body);
    } catch (err) {
      this.logger.error(
        `X webhook error: ${err instanceof Error ? err.message : err}`,
      );
    }
    return { status: 'ok', stub: true };
  }
}
