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
import {
  coerceJsonBody,
  parseIncomingDmsFromPayload,
  resolveWebhookBotUserId,
  summarizeXWebhookPayload,
  type XIncomingDm as ParsedIncomingDm,
} from './x-webhook-payload';

export type XIncomingDm = ParsedIncomingDm;

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
   * Webhook Account Activity / XAA: DMs → Localisto → reply DM.
   * Ignora tweets/menciones y ecos del propio bot.
   */
  async handleIncomingDm(payload: unknown, rawBody?: Buffer | string): Promise<void> {
    const body = coerceJsonBody(payload, rawBody);
    const bot = this.resolveBotUserId(body);
    const messages = parseIncomingDmsFromPayload(body, bot.botUserId);
    const summary = summarizeXWebhookPayload(body, messages);

    this.logger.log(
      `X webhook parse forUser=${summary.forUserId || '-'} botId=${bot.botUserId || '-'} botSrc=${bot.source} ` +
        `envelope=${summary.envelopeEventType || '-'} dmEvents=${summary.dmEventCount} parsed=${summary.parsedDmCount} ` +
        `inbound=${summary.inboundCount} echo=${summary.echoCount} typing=${summary.typingEventCount} ` +
        `chatEncrypted=${summary.chatEvent} keys=${summary.keys.join(',') || '(none)'}`,
    );

    if (summary.chatEvent && summary.parsedDmCount === 0) {
      this.logger.warn(
        'X webhook chat.received/sent (XChat cifrado): no hay texto plano que el bot pueda leer. ' +
          'Los DMs cifrados no se responden. Usa DM clásico (dm.received) o descifra encoded_event.',
      );
    }

    if (messages.length === 0) {
      this.logger.warn(
        `X webhook sin DMs de usuario parseables (¿echo, typing, tweet u otro evento?). ` +
          `otherEventKeys=${summary.otherEventKeys.join(',') || '-'} sample=${summary.sampleTexts.join(' | ') || '-'}`,
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
          `X DM passthrough echo=${!!msg.isEcho} sender=${msg.senderId} text=${JSON.stringify(msg.text)}`,
        );
      }
      this.logger.log(X_INBOUND_DISABLED_LOG);
      return;
    }

    for (const msg of messages) {
      await this.processOneDm(msg);
    }
  }

  resolveBotUserId(payload: Record<string, any> = {}): {
    botUserId: string | null;
    source: string;
  } {
    const envId = this.config.get<string>('X_BOT_USER_ID')?.trim();
    const accessToken = this.config.get<string>('X_ACCESS_TOKEN');
    const resolved = resolveWebhookBotUserId({
      payload,
      envBotUserId: envId,
      accessToken,
    });
    if (
      envId &&
      resolved.botUserId &&
      envId !== resolved.botUserId &&
      resolved.source.startsWith('payload')
    ) {
      this.logger.warn(
        `X_BOT_USER_ID=${envId} no coincide con for_user_id/filter.user_id=${resolved.botUserId} — se usa el ID del payload (cuenta suscrita) para no ignorar DMs de prueba`,
      );
    }
    return resolved;
  }

  private async processOneDm(msg: XIncomingDm): Promise<void> {
    if (msg.isEcho) {
      this.logger.log(
        `X DM echo omitido (propio bot) sender=${msg.senderId} messageId=${msg.messageId} text=${JSON.stringify(msg.text)}`,
      );
      return;
    }
    if (!msg.senderId || !msg.text?.trim()) {
      this.logger.warn(
        `X DM omitido (sin sender o texto) sender=${msg.senderId} text=${JSON.stringify(msg.text)}`,
      );
      return;
    }
    if (msg.messageId && this.processedMessageIds.has(msg.messageId)) {
      this.logger.log(`X DM ya procesado messageId=${msg.messageId}`);
      return;
    }

    this.logger.log(
      `X DM inbound → agente sender=${msg.senderId} messageId=${msg.messageId ?? 'n/a'} text=${JSON.stringify(msg.text)}`,
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
   * Parsea Account Activity (direct_message_events), XAA { data.payload } y dm_events v2.
   */
  parseIncomingDms(payload: unknown): XIncomingDm[] {
    const body = coerceJsonBody(payload);
    const bot = this.resolveBotUserId(body);
    return parseIncomingDmsFromPayload(body, bot.botUserId);
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
