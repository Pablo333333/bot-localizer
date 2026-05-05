import { Controller, Post, Body, Req, Res, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';
import { InboundService } from './inbound.service';
import * as twilio from 'twilio';

@Controller('v2/whatsapp')
export class WhatsAppWebhook {
  private readonly logger = new Logger(WhatsAppWebhook.name);

  constructor(private readonly inboundService: InboundService) {}

  @Post()
  async handleWebhook(@Body() body: any, @Req() req: Request, @Res() res: Response) {
    const isTwilio = !!body.From;
    const from = body.From || body.userId || 'webchat_user';
    const messageBody = body.Body || body.message;

    this.logger.log(`Webhook recibido de ${from} (${isTwilio ? 'Twilio' : 'Webchat'})`);

    try {
      const reply = await this.inboundService.handleIncomingMessage(from, messageBody);

      if (isTwilio) {
        const twiml = new twilio.twiml.MessagingResponse();
        twiml.message(reply);
        res.set('Content-Type', 'text/xml');
        return res.status(200).send(twiml.toString());
      } else {
        return res.status(200).json({ reply });
      }
    } catch (error) {
      this.logger.error(`Error procesando webhook: ${error.message}`);
      return res.status(500).json({ error: 'Internal Server Error' });
    }
  }
}
