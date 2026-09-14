import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import twilio, { Twilio } from 'twilio';
import { Channel } from '../enums';
import {
  formatE164Spain,
  renderTemplate,
  toWhatsAppAddress,
} from '../utils/phone.util';
import {
  ChannelSendPayload,
  ChannelSendResult,
  NurturingChannel,
} from './channel.interface';

/**
 * WhatsApp vía Twilio.
 *
 * Business Initiated requiere Content Template aprobado en canal WA.
 * Mientras `seguimiento_lead_fase3` no esté aprobado para WA, dejar
 * NURTURING_WHATSAPP_ENABLED≠true (default) para no intentar envíos que fallan
 * y dejar que el follow-up use SMS.
 */
@Injectable()
export class WhatsappChannel implements NurturingChannel {
  readonly channel = Channel.WHATSAPP;
  private readonly logger = new Logger(WhatsappChannel.name);
  private readonly client: Twilio | null;
  private readonly fromNumber: string | undefined;

  constructor(private readonly config: ConfigService) {
    const sid = this.config.get<string>('TWILIO_ACCOUNT_SID');
    const token = this.config.get<string>('TWILIO_AUTH_TOKEN');
    this.fromNumber = this.config.get<string>('TWILIO_WHATSAPP_NUMBER');
    this.client = sid && token ? twilio(sid, token) : null;
  }

  /** Gate explícito: sin true no se intenta WA business-initiated. */
  isEnabled(): boolean {
    const v = String(this.config.get('NURTURING_WHATSAPP_ENABLED') ?? '')
      .trim()
      .toLowerCase();
    return v === 'true' || v === '1' || v === 'yes' || v === 'si' || v === 'sí';
  }

  async send(payload: ChannelSendPayload): Promise<ChannelSendResult> {
    if (!this.isEnabled()) {
      const error =
        'WhatsApp nurturing deshabilitado (NURTURING_WHATSAPP_ENABLED≠true; plantilla WA no aprobada)';
      this.logger.warn(
        `[WhatsAppService] SKIP lead=${payload.leadId}: ${error}`,
      );
      return { success: false, error };
    }

    const bookingLink =
      (payload.templatePayload?.booking_link as string | undefined) ||
      this.config.get<string>('BOOKING_LINK') ||
      this.config.get<string>('BOOKING_LINK_CALL') ||
      this.config.get<string>('CALENDAR_BOOKING_URL') ||
      'https://www.localicer.com/agendar';

    const bodyTemplate =
      (payload.templatePayload?.body as string | undefined) ||
      'Hola {{name}}, no hemos podido hablar. Agenda tu visita aquí: {{booking_link}} — Localicer';

    const body = renderTemplate(bodyTemplate, {
      name: payload.name || 'hola',
      phone: payload.phone,
      email: payload.email,
      booking_link: bookingLink,
    });

    const e164 = formatE164Spain(payload.phone);
    const to = toWhatsAppAddress(payload.phone);

    this.logger.log(
      `[WhatsAppService] Intentando enviar mensaje a ${e164} (Twilio to=${to}) lead=${payload.leadId} stepRun=${payload.stepRunId}`,
    );
    this.logger.log(
      `[WhatsAppService] from=${this.fromNumber || '(no configurado)'} bodyChars=${body.length}`,
    );

    const forceMock =
      this.config.get<string>('NURTURING_MOCK_CHANNELS') === 'true';

    if (forceMock || !this.client || !this.fromNumber) {
      const mockId = `mock_wa_${Date.now()}`;
      this.logger.warn(
        `[WhatsAppService] MOCK — ${forceMock ? 'NURTURING_MOCK_CHANNELS=true' : 'Twilio no configurado (falta SID/TOKEN o TWILIO_WHATSAPP_NUMBER)'}\n` +
          `  to: ${to}\n` +
          `  e164: ${e164}\n` +
          `  body: ${body}\n` +
          `  leadId: ${payload.leadId}\n` +
          `  providerRef: ${mockId}`,
      );
      return { success: true, providerRef: mockId };
    }

    try {
      const contentSid = (
        payload.templatePayload?.contentSid as string | undefined
      )?.trim();
      const createParams: {
        from: string;
        to: string;
        body?: string;
        contentSid?: string;
        contentVariables?: string;
      } = {
        from: this.fromNumber,
        to,
      };
      if (contentSid) {
        createParams.contentSid = contentSid;
        const vars = payload.templatePayload?.contentVariables;
        if (vars != null) {
          createParams.contentVariables =
            typeof vars === 'string' ? vars : JSON.stringify(vars);
        }
      } else {
        createParams.body = body;
      }

      const message = await this.client.messages.create(createParams);

      this.logger.log(
        `[WhatsAppService] OK sid=${message.sid} to=${to} e164=${e164} status=${message.status}`,
      );
      return { success: true, providerRef: message.sid };
    } catch (error: any) {
      const twilioCode = error?.code ?? error?.status;
      const twilioMore = error?.moreInfo;
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `[WhatsAppService] ERROR enviando a ${e164} (to=${to}): ${message}` +
          (twilioCode != null ? ` | code=${twilioCode}` : '') +
          (twilioMore ? ` | moreInfo=${twilioMore}` : ''),
      );
      if (error?.response?.data || error?.details) {
        this.logger.error(
          `[WhatsAppService] Detalle Twilio: ${JSON.stringify(error.response?.data || error.details)}`,
        );
      }
      return { success: false, error: message };
    }
  }
}
