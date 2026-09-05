import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosError } from 'axios';
import {
  X_INBOUND_DISABLED_LOG,
  isXInboundAutoReplyEnabled,
  resolveXCredentials,
} from './x-inbound-enabled';
import { XChatService } from './x-chat.service';
import {
  XOAuthCredentials,
  buildCrcResponseToken,
  buildOAuth1Header,
} from './x-oauth';

export interface XIncomingDm {
  senderId: string | null;
  recipientId: string | null;
  text: string | null;
  messageId?: string | null;
  /** true si el mensaje lo envió la cuenta del bot (echo) */
  isEcho?: boolean;
}

export interface XSendResult {
  success: boolean;
  messageId?: string;
  error?: string;
  rateLimited?: boolean;
  retryAfterMs?: number;
}

const DM_V2_BASE = 'https://api.x.com/2/dm_conversations/with';
/** Legacy pedido por Toni; se usa si X_DM_API_VERSION=v1.1 */
const DM_V1_EVENTS_NEW =
  'https://api.x.com/1.1/direct_messages/events/new.json';

/**
 * X (Twitter) Direct Messages — solo DMs (no tweets / menciones públicas).
 * Webhook Account Activity + respuesta Localisto vía Retell (X_AGENT_ID) o InboundService.
 */
@Injectable()
export class XService {
  private readonly logger = new Logger(XService.name);
  /** Evita reprocesar el mismo event_id (reintentos de webhook). */
  private readonly processedMessageIds = new Set<string>();
  private readonly maxProcessed = 2_000;

  constructor(
    private readonly config: ConfigService,
    private readonly chat: XChatService,
  ) {}

  getCredentials(): XOAuthCredentials | null {
    const c = resolveXCredentials((k) => this.config.get<string>(k));
    if (!c.apiKey || !c.apiSecret || !c.accessToken || !c.accessSecret) {
      return null;
    }
    return {
      apiKey: c.apiKey,
      apiSecret: c.apiSecret,
      accessToken: c.accessToken,
      accessSecret: c.accessSecret,
    };
  }

  /** CRC Account Activity API — firma HMAC-SHA256(crc_token, consumer_secret). */
  verifyCrc(crcToken: string): string | null {
    const secret = (
      this.config.get<string>('X_API_SECRET') ||
      this.config.get<string>('X_CONSUMER_SECRET') ||
      ''
    ).trim();
    const token = (crcToken || '').trim();
    if (!token || !secret) return null;
    return buildCrcResponseToken(token, secret);
  }

  /**
   * Envía DM 1:1.
   * Por defecto API v2: POST /2/dm_conversations/with/:id/messages
   * Legacy: POST /1.1/direct_messages/events/new.json (X_DM_API_VERSION=v1.1)
   */
  async sendDirectMessage(
    recipientId: string,
    text: string,
  ): Promise<XSendResult> {
    const credentials = this.getCredentials();
    if (!credentials) {
      const error =
        'Credenciales X incompletas (X_API_KEY, X_API_SECRET, X_ACCESS_TOKEN, X_ACCESS_SECRET)';
      this.logger.error(`X sendDirectMessage: ${error}`);
      return { success: false, error };
    }

    if (!recipientId?.trim() || !text?.trim()) {
      return { success: false, error: 'recipientId o text vacío' };
    }

    const truncated =
      text.length > 9_000 ? `${text.slice(0, 8_970)}…` : text.trim();

    const version = (
      this.config.get<string>('X_DM_API_VERSION') || 'v2'
    ).toLowerCase();

    try {
      if (version === 'v1.1' || version === 'v1') {
        return await this.sendDmV11(credentials, recipientId, truncated);
      }
      return await this.sendDmV2(credentials, recipientId, truncated);
    } catch (err) {
      return this.mapSendError(err, recipientId);
    }
  }

  private async sendDmV2(
    credentials: XOAuthCredentials,
    recipientId: string,
    text: string,
  ): Promise<XSendResult> {
    const url = `${DM_V2_BASE}/${encodeURIComponent(recipientId)}/messages`;
    const auth = buildOAuth1Header('POST', url, credentials);
    const { data, status } = await axios.post(
      url,
      { text },
      {
        headers: {
          Authorization: auth,
          'Content-Type': 'application/json',
        },
        timeout: 20_000,
        validateStatus: (s) => s < 500,
      },
    );

    if (status === 429) {
      const retryAfterMs = this.parseRetryAfterMs(data) ?? 60_000;
      this.logger.warn(
        `X DM rate limit recipient=${recipientId} retryAfterMs=${retryAfterMs}`,
      );
      return {
        success: false,
        error: 'rate_limited',
        rateLimited: true,
        retryAfterMs,
      };
    }

    if (status >= 400) {
      const msg =
        data?.detail ||
        data?.title ||
        data?.errors?.[0]?.message ||
        JSON.stringify(data);
      this.logger.error(`X DM v2 error status=${status}: ${msg}`);
      return { success: false, error: String(msg) };
    }

    const messageId =
      data?.data?.dm_event_id != null
        ? String(data.data.dm_event_id)
        : undefined;
    this.logger.log(
      `X DM v2 OK recipient=${recipientId} event=${messageId ?? 'n/a'}`,
    );
    return { success: true, messageId };
  }

  /** Compat: POST /1.1/direct_messages/events/new.json */
  private async sendDmV11(
    credentials: XOAuthCredentials,
    recipientId: string,
    text: string,
  ): Promise<XSendResult> {
    const url = DM_V1_EVENTS_NEW;
    const body = {
      event: {
        type: 'message_create',
        message_create: {
          target: { recipient_id: recipientId },
          message_data: { text },
        },
      },
    };
    const auth = buildOAuth1Header('POST', url, credentials);
    const { data, status } = await axios.post(url, body, {
      headers: {
        Authorization: auth,
        'Content-Type': 'application/json',
      },
      timeout: 20_000,
      validateStatus: (s) => s < 500,
    });

    if (status === 429) {
      return {
        success: false,
        error: 'rate_limited',
        rateLimited: true,
        retryAfterMs: 60_000,
      };
    }
    if (status >= 400) {
      const msg =
        data?.errors?.[0]?.message || data?.error || JSON.stringify(data);
      return { success: false, error: String(msg) };
    }

    const messageId =
      data?.event?.id != null ? String(data.event.id) : undefined;
    this.logger.log(
      `X DM v1.1 OK recipient=${recipientId} event=${messageId ?? 'n/a'}`,
    );
    return { success: true, messageId };
  }

  /**
   * Webhook Account Activity: DMs → Localisto → reply DM.
   * Ignora tweets/menciones y ecos del propio bot.
   */
  async handleIncomingDm(payload: unknown): Promise<void> {
    const messages = this.parseIncomingDms(payload);
    if (messages.length === 0) {
      this.logger.debug(
        'X webhook sin DMs de usuario (echo, tweet u otro evento)',
      );
      return;
    }

    const autoReply = isXInboundAutoReplyEnabled(
      this.config.get('X_INBOUND_AUTO_REPLY'),
      Boolean(this.chat.getAgentId()) ||
        Boolean(this.config.get<string>('OPENAI_API_KEY')?.trim()),
    );

    if (!autoReply) {
      for (const msg of messages) {
        this.logger.log(
          `X DM passthrough sender=${msg.senderId} text=${JSON.stringify(msg.text)}`,
        );
      }
      this.logger.log(X_INBOUND_DISABLED_LOG);
      return;
    }

    for (const msg of messages) {
      await this.processOneDm(msg);
    }
  }

  private async processOneDm(msg: XIncomingDm): Promise<void> {
    if (msg.isEcho) {
      this.logger.debug(`X DM echo omitido messageId=${msg.messageId}`);
      return;
    }
    if (!msg.senderId || !msg.text?.trim()) {
      this.logger.debug('X DM omitido (sin sender o texto)');
      return;
    }
    if (msg.messageId && this.processedMessageIds.has(msg.messageId)) {
      this.logger.debug(`X DM ya procesado messageId=${msg.messageId}`);
      return;
    }

    const botUserId = this.config.get<string>('X_BOT_USER_ID')?.trim();
    if (botUserId && msg.senderId === botUserId) {
      this.logger.debug('X DM del propio bot omitido (anti-bucle)');
      return;
    }

    this.logger.log(
      `X DM inbound sender=${msg.senderId} messageId=${msg.messageId ?? 'n/a'} chars=${msg.text.length}`,
    );

    let reply: string;
    try {
      reply = await this.chat.generateReply(msg.senderId, msg.text.trim());
    } catch (err) {
      this.logger.error(
        `X motor conversacional error: ${err instanceof Error ? err.message : err}`,
      );
      reply =
        'Hola, soy Localisto de Localicer. Ahora mismo tengo un problema técnico; ¿puedes escribirme de nuevo en un momento?';
    }

    if (!reply?.trim()) {
      this.logger.warn(`Respuesta vacía para sender=${msg.senderId}`);
      return;
    }

    let result = await this.sendDirectMessage(msg.senderId, reply);
    if (result.rateLimited) {
      const wait = Math.min(result.retryAfterMs ?? 60_000, 120_000);
      this.logger.warn(`X rate limit — reintento en ${wait}ms`);
      await new Promise((r) => setTimeout(r, wait));
      result = await this.sendDirectMessage(msg.senderId, reply);
    }

    if (result.success && msg.messageId) {
      this.rememberProcessed(msg.messageId);
    }
  }

  /**
   * Parsea Account Activity (direct_message_events) y payloads v2 dm_events.
   * No incluye tweets ni menciones.
   */
  parseIncomingDms(payload: unknown): XIncomingDm[] {
    const body = payload as Record<string, any>;
    const results: XIncomingDm[] = [];
    const botUserId = this.config.get<string>('X_BOT_USER_ID')?.trim();

    const events = Array.isArray(body?.direct_message_events)
      ? body.direct_message_events
      : [];

    for (const event of events) {
      if (event?.type && event.type !== 'message_create') continue;
      const mc = event?.message_create;
      if (!mc) continue;

      const senderId =
        mc.sender_id != null ? String(mc.sender_id) : null;
      const recipientId =
        mc.target?.recipient_id != null
          ? String(mc.target.recipient_id)
          : null;
      const text =
        mc.message_data?.text != null
          ? String(mc.message_data.text)
          : null;
      const messageId = event.id != null ? String(event.id) : null;
      const isEcho = Boolean(
        botUserId && senderId && senderId === botUserId,
      );

      results.push({
        senderId,
        recipientId,
        text,
        messageId,
        isEcho,
      });
    }

    // Formato alternativo: { dm_events: [...] } (API v2 webhooks / polling)
    const dmEvents = Array.isArray(body?.dm_events) ? body.dm_events : [];
    for (const event of dmEvents) {
      if (event?.event_type && event.event_type !== 'MessageCreate') {
        continue;
      }
      const senderId =
        event?.sender_id != null ? String(event.sender_id) : null;
      const text =
        event?.text != null
          ? String(event.text)
          : event?.message_create?.message_data?.text != null
            ? String(event.message_create.message_data.text)
            : null;
      const messageId =
        event?.id != null
          ? String(event.id)
          : event?.dm_event_id != null
            ? String(event.dm_event_id)
            : null;
      const isEcho = Boolean(
        botUserId && senderId && senderId === botUserId,
      );
      if (!text && !senderId) continue;
      results.push({
        senderId,
        recipientId: null,
        text,
        messageId,
        isEcho,
      });
    }

    return results;
  }

  private rememberProcessed(id: string): void {
    this.processedMessageIds.add(id);
    if (this.processedMessageIds.size > this.maxProcessed) {
      const first = this.processedMessageIds.values().next().value;
      if (first) this.processedMessageIds.delete(first);
    }
  }

  private parseRetryAfterMs(data: unknown): number | null {
    const headersHint = data as { retry_after?: number };
    if (typeof headersHint?.retry_after === 'number') {
      return headersHint.retry_after * 1000;
    }
    return null;
  }

  private mapSendError(err: unknown, recipientId: string): XSendResult {
    const axiosErr = err as AxiosError<any>;
    const status = axiosErr.response?.status;
    if (status === 429) {
      const retryAfterHeader = axiosErr.response?.headers?.['retry-after'];
      const retryAfterMs = retryAfterHeader
        ? Number(retryAfterHeader) * 1000
        : 60_000;
      this.logger.warn(
        `X DM 429 recipient=${recipientId} retryAfterMs=${retryAfterMs}`,
      );
      return {
        success: false,
        error: 'rate_limited',
        rateLimited: true,
        retryAfterMs: Number.isFinite(retryAfterMs) ? retryAfterMs : 60_000,
      };
    }
    const apiMessage =
      axiosErr.response?.data?.detail ||
      axiosErr.response?.data?.errors?.[0]?.message ||
      (err instanceof Error ? err.message : String(err));
    this.logger.error(
      `X sendDirectMessage falló recipient=${recipientId}: ${apiMessage}`,
    );
    return { success: false, error: String(apiMessage) };
  }
}
