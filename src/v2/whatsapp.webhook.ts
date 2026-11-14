import {
  Controller,
  Post,
  Body,
  Req,
  Res,
  Headers,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import * as twilio from 'twilio';
import { InboundService } from './inbound.service';
import { OwnerReplyService } from '../nurturing/inbound-owner/owner-reply.service';
import {
  buildTwilioSignedUrl,
  isTwilioSignatureValidationEnabled,
  verifyTwilioSignature,
} from '../nurturing/inbound-owner/twilio-signature';

@Controller('v2/whatsapp')
export class WhatsAppWebhook {
  private readonly logger = new Logger(WhatsAppWebhook.name);

  constructor(
    private readonly inboundService: InboundService,
    private readonly ownerReply: OwnerReplyService,
    private readonly config: ConfigService,
  ) {}

  @Post()
  async handleWebhook(
    @Body() body: any,
    @Req() req: Request,
    @Res() res: Response,
    @Headers('x-twilio-signature') twilioSignature?: string,
  ) {
    const isTwilio = !!body.From;
    const from = body.From || body.userId || 'webchat_user';
    const messageBody = body.Body || body.message;

    this.logger.log(
      `Webhook recibido de ${from} (${isTwilio ? 'Twilio' : 'Webchat'})`,
    );

    if (isTwilio) {
      this.assertTwilioSignature(req, body, twilioSignature);
    }

    try {
      let reply: string;

      if (isTwilio && messageBody) {
        try {
          const resolved = await this.ownerReply.resolveAdvertiser(from);
          if (resolved.isAdvertiser) {
            this.logger.log(
              `[WA Router] anunciante e164=${resolved.e164} leads=${resolved.leadIds.length} sheetRows=${resolved.sheetRows.length} ambiguous=${resolved.ambiguous}`,
            );
            const result = await this.ownerReply.handleAdvertiserMessage({
              from,
              body: String(messageBody),
            });
            reply = result.reply;
          } else {
            reply = await this.inboundService.handleIncomingMessage(
              from,
              messageBody,
            );
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          if (msg === 'not_advertiser') {
            reply = await this.inboundService.handleIncomingMessage(
              from,
              messageBody,
            );
          } else {
            throw err;
          }
        }
      } else {
        reply = await this.inboundService.handleIncomingMessage(
          from,
          messageBody,
        );
      }

      if (isTwilio) {
        const twiml = new twilio.twiml.MessagingResponse();
        twiml.message(reply);
        res.set('Content-Type', 'text/xml');
        return res.status(200).send(twiml.toString());
      }
      return res.status(200).json({ reply });
    } catch (error: any) {
      this.logger.error(
        `Error procesando webhook: ${error?.message || error}`,
      );
      return res.status(500).json({ error: 'Internal Server Error' });
    }
  }

  private assertTwilioSignature(
    req: Request,
    body: Record<string, unknown>,
    signature?: string,
  ): void {
    if (
      !isTwilioSignatureValidationEnabled(
        this.config.get('TWILIO_VALIDATE_SIGNATURE'),
      )
    ) {
      return;
    }
    const authToken = String(this.config.get('TWILIO_AUTH_TOKEN') || '').trim();
    if (!authToken) {
      this.logger.error(
        'TWILIO_VALIDATE_SIGNATURE=true pero falta TWILIO_AUTH_TOKEN',
      );
      throw new UnauthorizedException('twilio_auth_missing');
    }
    const publicBase = String(this.config.get('PUBLIC_BASE_URL') || '').replace(
      /\/$/,
      '',
    );
    const url = buildTwilioSignedUrl({
      protocol: req.protocol,
      host: req.get('host') || undefined,
      originalUrl: req.originalUrl,
      webhookUrl: publicBase ? `${publicBase}/v2/whatsapp` : undefined,
    });
    const ok = verifyTwilioSignature({
      authToken,
      signatureHeader: signature,
      url,
      body,
    });
    if (!ok) {
      this.logger.warn(`[WA] Firma Twilio inválida url=${url}`);
      throw new UnauthorizedException('twilio_signature_invalid');
    }
  }
}
