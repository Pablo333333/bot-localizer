import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import twilio, { Twilio } from 'twilio';
import { Channel } from '../enums';
import {
  parseTwilioContentVariables,
  renderToniNoAnswerFallback,
  twilioSeguimientoContentVariablesJson,
} from '../toni-fase3.constants';
import { formatE164Spain, toWhatsAppAddress } from '../utils/phone.util';
import {
  ChannelSendPayload,
  ChannelSendResult,
  NurturingChannel,
} from './channel.interface';
import { createTwilioMessageWithTemplateFallback } from './twilio-template-fallback';

/**
 * WhatsApp vía Twilio.
 *
 * Business Initiated requiere Content Template aprobado en canal WA.
 * Si la plantilla falla, reenvía el copy libre de agendamiento.
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
    const bypassGate = payload.templatePayload?.bypassWhatsappGate === true;
    if (!this.isEnabled() && !bypassGate) {
      const error =
        'WhatsApp nurturing deshabilitado (NURTURING_WHATSAPP_ENABLED≠true; plantilla WA no aprobada)';
      this.logger.warn(
        `[WhatsAppService] SKIP lead=${payload.leadId}: ${error}`,
      );
      return { success: false, error };
    }

    const contentVariables = parseTwilioContentVariables(
      payload.templatePayload?.contentVariables,
    );
    const bodyFromPayload = String(payload.templatePayload?.body ?? '').trim();
    const body =
      bodyFromPayload && !/\{\{[12]\}\}/.test(bodyFromPayload)
        ? bodyFromPayload
        : renderToniNoAnswerFallback(contentVariables, payload.name);

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
      const useTemplate = Boolean(contentSid);

      const message = await createTwilioMessageWithTemplateFallback(
        this.client,
        {
          from: this.fromNumber,
          to,
          body,
          contentSid: useTemplate ? contentSid : undefined,
          contentVariables: useTemplate
            ? twilioSeguimientoContentVariablesJson(contentVariables)
            : undefined,
        },
        this.logger,
        'WhatsAppService',
      );

      this.logger.log(
        `[FASE3][MENSAJE] WhatsApp enviado sid=${message.sid} to=${to} e164=${e164} status=${message.status}`,
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
