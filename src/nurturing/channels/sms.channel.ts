import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import twilio, { Twilio } from 'twilio';
import { Channel } from '../enums';
import {
  TWILIO_CONTENT_SID_SEGUIMIENTO_FASE3,
  parseTwilioContentVariables,
  renderToniNoAnswerFallback,
  twilioSeguimientoContentVariablesJson,
} from '../toni-fase3.constants';
import { formatE164Spain } from '../utils/phone.util';
import {
  ChannelSendPayload,
  ChannelSendResult,
  NurturingChannel,
} from './channel.interface';
import { createTwilioMessageWithTemplateFallback } from './twilio-template-fallback';

/**
 * SMS (Twilio). Preferencia: Content Template aprobado para SMS
 * (`TWILIO_SMS_CONTENT_SID`, {{1}} = título del inmueble; el enlace de
 * agendamiento lo incluye la plantilla). Si la plantilla falla,
 * reenvía el copy libre de agendamiento (nombre + inmueble + enlace).
 *
 * from: TWILIO_SMS_FROM → TWILIO_FROM_NUMBER → TWILIO_WHATSAPP_NUMBER sin prefijo whatsapp:
 */
@Injectable()
export class SmsChannel implements NurturingChannel {
  readonly channel = Channel.SMS;
  private readonly logger = new Logger(SmsChannel.name);
  private readonly client: Twilio | null;
  private readonly fromNumber: string | undefined;
  private readonly contentSid: string | undefined;

  constructor(private readonly config: ConfigService) {
    const sid = this.config.get<string>('TWILIO_ACCOUNT_SID');
    const token = this.config.get<string>('TWILIO_AUTH_TOKEN');
    this.fromNumber = this.resolveFromNumber();
    this.contentSid = this.resolveContentSid();
    this.client = sid && token ? twilio(sid, token) : null;
  }

  private resolveFromNumber(): string | undefined {
    const explicit =
      this.config.get<string>('TWILIO_SMS_FROM') ||
      this.config.get<string>('TWILIO_FROM_NUMBER');
    if (explicit?.trim()) {
      return explicit.trim().replace(/^whatsapp:/i, '');
    }
    const wa = this.config.get<string>('TWILIO_WHATSAPP_NUMBER')?.trim();
    if (wa) return wa.replace(/^whatsapp:/i, '');
    return undefined;
  }

  /**
   * Content SID por defecto = plantilla SMS de seguimiento.
   * Vacío explícito en env desactiva Content API y usa body libre.
   */
  private resolveContentSid(): string | undefined {
    const raw =
      this.config.get<string>('TWILIO_SMS_CONTENT_SID') ??
      this.config.get<string>('TWILIO_CONTENT_SID_SEGUIMIENTO');
    if (raw !== undefined && String(raw).trim() === '') {
      return undefined;
    }
    const v = String(raw ?? TWILIO_CONTENT_SID_SEGUIMIENTO_FASE3).trim();
    return v || undefined;
  }

  async send(payload: ChannelSendPayload): Promise<ChannelSendResult> {
    const contentSid =
      (payload.templatePayload?.contentSid as string | undefined)?.trim() ||
      this.contentSid;

    const contentVariables = parseTwilioContentVariables(
      payload.templatePayload?.contentVariables ??
        this.config.get<string>('TWILIO_SMS_CONTENT_VARIABLES'),
    );

    const bodyFromPayload = String(payload.templatePayload?.body ?? '').trim();
    const body =
      bodyFromPayload && !/\{\{[12]\}\}/.test(bodyFromPayload)
        ? bodyFromPayload
        : renderToniNoAnswerFallback(contentVariables, payload.name);

    const forceMock =
      this.config.get<string>('NURTURING_MOCK_CHANNELS') === 'true';

    if (forceMock) {
      const mockId = `mock_sms_${Date.now()}`;
      this.logger.warn(
        `[MOCK SMS] NURTURING_MOCK_CHANNELS=true — simulado OK\n` +
          `  to: ${formatE164Spain(payload.phone)}\n` +
          `  contentSid: ${contentSid || '(body libre)'}\n` +
          `  body: ${body}\n` +
          `  providerRef: ${mockId}`,
      );
      return { success: true, providerRef: mockId };
    }

    if (!this.client || !this.fromNumber) {
      const error =
        'Twilio SMS no configurado (falta TWILIO_ACCOUNT_SID/AUTH_TOKEN o número from)';
      this.logger.error(
        `[SmsService] ${error} lead=${payload.leadId} stepRun=${payload.stepRunId}`,
      );
      return { success: false, error };
    }

    const to = formatE164Spain(payload.phone);
    this.logger.log(
      `[SmsService] Intentando SMS to=${to} from=${this.fromNumber} ` +
        `contentSid=${contentSid || '(body)'} lead=${payload.leadId} stepRun=${payload.stepRunId}`,
    );

    try {
      const propertyTitle = contentVariables['1'] || contentVariables['2'];
      const useTemplate = Boolean(contentSid);
      if (contentSid && !propertyTitle) {
        this.logger.warn(
          `[SmsService] {{1}} título vacío — se envía plantilla con fallback to=${to}`,
        );
      }

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
        'SmsService',
      );
      this.logger.log(
        `[SmsService] OK sid=${message.sid} to=${to} status=${message.status} ` +
          `contentSid=${contentSid || 'n/a'} lead=${payload.leadId}`,
      );
      return { success: true, providerRef: message.sid };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const twilioCode = (error as { code?: number })?.code;
      this.logger.error(
        `[SmsService] ERROR to=${to} lead=${payload.leadId}: ${message}` +
          (twilioCode != null ? ` | code=${twilioCode}` : ''),
      );
      return { success: false, error: message };
    }
  }
}
