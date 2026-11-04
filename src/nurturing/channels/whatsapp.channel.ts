import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Channel as PrismaChannel } from '@prisma/client';
import twilio, { Twilio } from 'twilio';
import { PrismaService } from '../../prisma/prisma.service';
import {
  PAUSE_ALL_AUTOMATIONS_LOG,
  isPauseAllAutomations,
} from '../../outbound/pause-automations';
import { Channel } from '../enums';
import {
  parseTwilioContentVariables,
  renderToniNoAnswerFallback,
  resolveWhatsappSeguimientoContentSid,
  TONI_WHATSAPP_SHORT_LINK,
  TWILIO_WHATSAPP_TEMPLATE_NAME,
  twilioSeguimientoContentVariablesJson,
} from '../toni-fase3.constants';
import { formatE164Spain, toWhatsAppAddress } from '../utils/phone.util';
import {
  ChannelSendPayload,
  ChannelSendResult,
  NurturingChannel,
} from './channel.interface';
import { isProviderBalanceError } from '../engine/provider-balance';

export const FAILED_WHATSAPP_SUMMARY = 'FAILED_WHATSAPP';

/**
 * WhatsApp vía Twilio.
 *
 * Business Initiated usa la plantilla aprobada `seguimiento_fase_3_2`
 * ({{1}} = título del inmueble; wa.me/34644408099 va fijo en el cuerpo).
 *
 * Sin fallback a SMS ni a texto libre / otro canal si Twilio falla
 * (p.ej. code 63007): se registra FAILED_WHATSAPP y se aborta el envío.
 */
@Injectable()
export class WhatsappChannel implements NurturingChannel {
  readonly channel = Channel.WHATSAPP;
  private readonly logger = new Logger(WhatsappChannel.name);
  private readonly client: Twilio | null;
  private readonly fromNumber: string | undefined;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
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
    if (isPauseAllAutomations(this.config.get('PAUSE_ALL_AUTOMATIONS'))) {
      this.logger.warn(
        `${PAUSE_ALL_AUTOMATIONS_LOG} lead=${payload.leadId} stepRun=${payload.stepRunId}`,
      );
      return { success: true, providerRef: 'paused_no_whatsapp' };
    }

    const bypassGate = payload.templatePayload?.bypassWhatsappGate === true;
    if (!this.isEnabled() && !bypassGate) {
      const error =
        'WhatsApp nurturing deshabilitado (NURTURING_WHATSAPP_ENABLED≠true; plantilla WA no aprobada)';
      this.logger.warn(
        `[WhatsAppService] SKIP lead=${payload.leadId}: ${error}`,
      );
      return { success: false, error, permanent: true };
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
      const contentSid = resolveWhatsappSeguimientoContentSid({
        envSid: this.config.get<string>('TWILIO_WHATSAPP_CONTENT_SID'),
        payloadSid: payload.templatePayload?.contentSid as string | undefined,
      });
      const useTemplate = Boolean(contentSid);
      const variablesJson = useTemplate
        ? twilioSeguimientoContentVariablesJson(contentVariables)
        : undefined;

      this.logger.log(
        `[WhatsAppService] plantilla=${TWILIO_WHATSAPP_TEMPLATE_NAME} contentSid=${contentSid || '(body libre)'} contentVariables=${variablesJson || '-'} shortLink=${TONI_WHATSAPP_SHORT_LINK}`,
      );

      // Un solo intento: sin fallback a texto libre ni a SMS / otro número.
      const message = useTemplate
        ? await this.client.messages.create({
            from: this.fromNumber,
            to,
            contentSid: contentSid!,
            ...(variablesJson ? { contentVariables: variablesJson } : {}),
          })
        : await this.client.messages.create({
            from: this.fromNumber,
            to,
            body,
          });

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

      await this.logFailedWhatsapp(payload, message, twilioCode);

      if (isProviderBalanceError(message, twilioCode)) {
        return { success: false, error: message, hold: 'provider_balance' };
      }

      // Cualquier error de WA aborta mensajería del lead (sin SMS ni reintentos BullMQ).
      return { success: false, error: message, permanent: true };
    }
  }

  /**
   * Persiste el fallo en CommunicationLog y aborta el flujo de mensajería
   * del lead (sin SMS ni reintento de canal alternativo).
   */
  private async logFailedWhatsapp(
    payload: ChannelSendPayload,
    errorMessage: string,
    twilioCode?: number | string,
  ): Promise<void> {
    try {
      const stepRunId =
        payload.stepRunId && !payload.stepRunId.includes(':')
          ? payload.stepRunId
          : undefined;
      await this.prisma.communicationLog.create({
        data: {
          leadId: payload.leadId,
          channel: PrismaChannel.whatsapp,
          direction: 'outbound',
          summary: FAILED_WHATSAPP_SUMMARY,
          providerRef: twilioCode != null ? String(twilioCode) : undefined,
          stepRunId,
        },
      });
      this.logger.warn(
        `[WhatsAppService] ${FAILED_WHATSAPP_SUMMARY} lead=${payload.leadId} stepRun=${payload.stepRunId} code=${twilioCode ?? 'n/a'}: ${errorMessage}`,
      );
    } catch (err) {
      this.logger.error(
        `[WhatsAppService] no se pudo persistir ${FAILED_WHATSAPP_SUMMARY}: ${
          err instanceof Error ? err.message : err
        }`,
      );
    }
  }
}
