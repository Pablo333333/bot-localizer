import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import twilio, { Twilio } from 'twilio';
import { Channel } from '../enums';
import { TWILIO_CONTENT_SID_SEGUIMIENTO_FASE3 } from '../toni-fase3.constants';
import { formatE164Spain, renderTemplate } from '../utils/phone.util';
import {
  ChannelSendPayload,
  ChannelSendResult,
  NurturingChannel,
} from './channel.interface';

/**
 * SMS (Twilio). Preferencia: Content Template aprobado para SMS
 * (`seguimiento_lead_fase3` / TWILIO_SMS_CONTENT_SID). Fallback a body libre
 * solo si el Content SID está vacío (`TWILIO_SMS_CONTENT_SID=`).
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
   * Content SID por defecto = seguimiento_lead_fase3.
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

    const bookingLink =
      (payload.templatePayload?.booking_link as string | undefined) ||
      this.config.get<string>('BOOKING_LINK_CALL') ||
      this.config.get<string>('BOOKING_LINK') ||
      this.config.get<string>('CALENDAR_BOOKING_URL') ||
      'https://www.localicer.com/agendar';

    const bodyTemplate =
      (payload.templatePayload?.body as string | undefined) ||
      'Hola {{name}}, desde Localicer te escribimos por SMS. Agenda aquí: {{booking_link}}';

    const body = renderTemplate(bodyTemplate, {
      name: payload.name || '',
      phone: payload.phone,
      booking_link: bookingLink,
    });

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
        const vars =
          payload.templatePayload?.contentVariables ??
          this.config.get<string>('TWILIO_SMS_CONTENT_VARIABLES');
        if (vars != null) {
          const parsed =
            typeof vars === 'string'
              ? (() => {
                  try {
                    return JSON.parse(vars) as Record<string, string>;
                  } catch {
                    return null;
                  }
                })()
              : (vars as Record<string, string>);
          const v1 = String(parsed?.['1'] ?? '').trim();
          const v2 = String(parsed?.['2'] ?? '').trim();
          // Content SID sin variables → Twilio falla; usar body libre.
          if (!v1 && !v2) {
            this.logger.warn(
              `[SmsService] Content vars vacías — fallback a body libre to=${to}`,
            );
            createParams.body = body;
            delete createParams.contentSid;
          } else {
            createParams.contentVariables = JSON.stringify({
              '1': v1 || 'cliente',
              '2': v2 || 'tu anuncio',
            });
          }
        }
      } else {
        createParams.body = body;
      }

      const message = await this.client.messages.create(createParams);
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
