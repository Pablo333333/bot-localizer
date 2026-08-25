import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosError } from 'axios';
import { InboundService } from '../v2/inbound.service';
import {
  META_INBOUND_DISABLED_LOG,
  isMetaInboundAutoReplyEnabled,
} from './meta-inbound-enabled';

export type MetaPlatform = 'messenger' | 'instagram' | 'unknown';

export interface MetaIncomingMessage {
  platform: MetaPlatform;
  senderId: string | null;
  recipientId: string | null;
  text: string | null;
  mid?: string | null;
  timestamp?: number | null;
}

export interface MetaSendResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

const GRAPH_API_VERSION = 'v19.0';
const GRAPH_MESSAGES_URL = `https://graph.facebook.com/${GRAPH_API_VERSION}/me/messages`;

/**
 * Fase 4 — Meta:
 * - Webhook verification + ack de eventos (GHL gestiona el inbox DM).
 * - Send API disponible para usos controlados.
 * - Auto-reply Localisto OFF por defecto (META_INBOUND_AUTO_REPLY).
 * Nurturing WhatsApp (T+0 / T+7) sigue por Twilio en NurturingModule.
 */
@Injectable()
export class MetaService {
  private readonly logger = new Logger(MetaService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly inbound: InboundService,
  ) {}

  /**
   * Envía un mensaje de texto al usuario vía Graph API Send API.
   * Usa META_PAGE_ACCESS_TOKEN (Page Access Token).
   */
  async sendMessage(
    recipientId: string,
    text: string,
    platform: 'messenger' | 'instagram',
  ): Promise<MetaSendResult> {
    const accessToken = this.config.get<string>('META_PAGE_ACCESS_TOKEN');
    if (!accessToken) {
      const error = 'META_PAGE_ACCESS_TOKEN no configurado';
      this.logger.error(`Meta sendMessage falló (${platform}): ${error}`);
      return { success: false, error };
    }

    if (!recipientId?.trim()) {
      const error = 'recipientId vacío';
      this.logger.error(`Meta sendMessage falló (${platform}): ${error}`);
      return { success: false, error };
    }

    const body = {
      recipient: { id: recipientId },
      messaging_type: 'RESPONSE',
      message: { text },
    };

    try {
      const { data } = await axios.post(GRAPH_MESSAGES_URL, body, {
        params: { access_token: accessToken },
        headers: { 'Content-Type': 'application/json' },
        timeout: 15_000,
      });

      const messageId =
        data?.message_id != null ? String(data.message_id) : undefined;
      this.logger.log(
        `Meta send OK platform=${platform} recipient=${recipientId} mid=${messageId ?? 'n/a'}`,
      );
      return { success: true, messageId };
    } catch (err) {
      const axiosErr = err as AxiosError<{ error?: { message?: string } }>;
      const apiMessage =
        axiosErr.response?.data?.error?.message ||
        (err instanceof Error ? err.message : String(err));
      this.logger.error(
        `Meta sendMessage falló (${platform}) recipient=${recipientId}: ${apiMessage}`,
      );
      return { success: false, error: apiMessage };
    }
  }

  /**
   * Webhook entrante. Por defecto solo loguea (GHL responde en DM).
   * Si META_INBOUND_AUTO_REPLY=true, genera respuesta Localisto y envía por Send API.
   */
  async handleIncomingMessage(payload: any): Promise<void> {
    const messages = this.parseIncomingMessages(payload);

    if (messages.length === 0) {
      this.logger.debug(
        'Webhook Meta sin mensajes de usuario (echo/delivery/read u otro evento)',
      );
      return;
    }

    const autoReply = isMetaInboundAutoReplyEnabled(
      this.config.get('META_INBOUND_AUTO_REPLY'),
    );

    if (!autoReply) {
      for (const msg of messages) {
        this.logger.log(
          `Meta inbound (passthrough GHL) platform=${msg.platform} sender=${msg.senderId} text=${JSON.stringify(msg.text)}`,
        );
      }
      this.logger.log(META_INBOUND_DISABLED_LOG);
      return;
    }

    for (const msg of messages) {
      this.logger.log(
        `Meta message platform=${msg.platform} sender=${msg.senderId} recipient=${msg.recipientId} text=${JSON.stringify(msg.text)}`,
      );

      if (!msg.senderId || !msg.text?.trim()) {
        this.logger.debug(
          'Meta message omitido (sin senderId o sin texto usable)',
        );
        continue;
      }

      if (msg.platform !== 'messenger' && msg.platform !== 'instagram') {
        this.logger.warn(
          `Meta platform desconocida (${msg.platform}); no se responde`,
        );
        continue;
      }

      const sessionKey = `meta:${msg.platform}:${msg.senderId}`;
      let reply: string;
      try {
        reply = await this.inbound.handleIncomingMessage(
          sessionKey,
          msg.text.trim(),
        );
      } catch (err) {
        this.logger.error(
          `Error motor conversacional Meta: ${err instanceof Error ? err.message : err}`,
        );
        reply =
          'Hola, soy Localisto de Localicer. Ahora mismo tengo un problema técnico; ¿puedes escribirme de nuevo en un momento?';
      }

      if (!reply?.trim()) {
        this.logger.warn(
          `Respuesta vacía del motor conversacional para ${sessionKey}`,
        );
        continue;
      }

      await this.sendMessage(msg.senderId, reply, msg.platform);
    }
  }

  parseIncomingMessages(payload: any): MetaIncomingMessage[] {
    const entries = Array.isArray(payload?.entry) ? payload.entry : [];
    const objectType = String(payload?.object || '').toLowerCase();
    const results: MetaIncomingMessage[] = [];

    for (const entry of entries) {
      const messaging = Array.isArray(entry?.messaging)
        ? entry.messaging
        : Array.isArray(entry?.standby)
          ? entry.standby
          : [];

      for (const event of messaging) {
        const text =
          event?.message?.text != null
            ? String(event.message.text)
            : event?.postback?.payload != null
              ? String(event.postback.payload)
              : null;

        if (event?.message?.is_echo) continue;
        if (!text && !event?.message && !event?.postback) continue;

        results.push({
          platform: this.resolvePlatform(objectType, entry),
          senderId: event?.sender?.id != null ? String(event.sender.id) : null,
          recipientId:
            event?.recipient?.id != null ? String(event.recipient.id) : null,
          text,
          mid: event?.message?.mid != null ? String(event.message.mid) : null,
          timestamp:
            typeof event?.timestamp === 'number' ? event.timestamp : null,
        });
      }
    }

    return results;
  }

  private resolvePlatform(
    objectType: string,
    entry: Record<string, unknown>,
  ): MetaPlatform {
    if (objectType === 'instagram' || entry?.id === 'instagram') {
      return 'instagram';
    }
    if (objectType === 'page' || objectType === 'messenger') {
      return 'messenger';
    }
    return 'unknown';
  }
}
