/**
 * Normaliza webhooks de X (Account Activity clásico + X Activity API).
 *
 * Formatos reales:
 * - AAA: { for_user_id, direct_message_events: [{ type: 'message_create', message_create: {...} }] }
 * - XAA: { data: { event_type: 'dm.received'|'dm.sent', filter: { user_id }, payload: { direct_message_events } } }
 * - v2 polling: { dm_events: [{ event_type: 'MessageCreate', text, sender_id }] }
 */

export type XIncomingDm = {
  senderId: string | null;
  recipientId: string | null;
  text: string | null;
  messageId?: string | null;
  isEcho?: boolean;
  eventType?: string | null;
};

export type XWebhookSummary = {
  keys: string[];
  forUserId: string | null;
  envelopeEventType: string | null;
  dmEventCount: number;
  typingEventCount: number;
  chatEvent: boolean;
  otherEventKeys: string[];
  parsedDmCount: number;
  inboundCount: number;
  echoCount: number;
  sampleTexts: string[];
};

const MESSAGE_CREATE_TYPES = new Set([
  'message_create',
  'messagecreate',
  'dm.received',
  'dm.sent',
]);

function asRecord(value: unknown): Record<string, any> | null {
  if (value && typeof value === 'object' && !Array.isArray(value) && !Buffer.isBuffer(value)) {
    return value as Record<string, any>;
  }
  return null;
}

function asArray(value: unknown): any[] {
  return Array.isArray(value) ? value : [];
}

export function coerceJsonBody(
  body: unknown,
  rawBody?: Buffer | string | null,
): Record<string, any> {
  if (typeof body === 'string' && body.trim()) {
    try {
      const parsed = JSON.parse(body);
      const rec = asRecord(parsed);
      if (rec) return rec;
    } catch {
      /* fall through */
    }
  }

  const rec = asRecord(body);
  if (rec && Object.keys(rec).length > 0) return rec;

  if (rawBody && (Buffer.isBuffer(rawBody) ? rawBody.length : String(rawBody).length)) {
    const text = Buffer.isBuffer(rawBody)
      ? rawBody.toString('utf8')
      : String(rawBody);
    try {
      const parsed = JSON.parse(text);
      const fromRaw = asRecord(parsed);
      if (fromRaw) return fromRaw;
    } catch {
      /* ignore */
    }
  }

  return rec || {};
}

export function userIdFromAccessToken(accessToken?: string | null): string | null {
  const m = String(accessToken || '')
    .trim()
    .match(/^(\d+)-/);
  return m?.[1] || null;
}

/** ID de la cuenta suscrita (bot), no del usuario que escribe el DM de prueba. */
export function resolveWebhookBotUserId(params: {
  payload: Record<string, any>;
  envBotUserId?: string | null;
  accessToken?: string | null;
}): { botUserId: string | null; source: string } {
  const body = params.payload || {};
  const data = asRecord(body.data);
  const fromPayload =
    String(body.for_user_id || '').trim() ||
    String(data?.filter?.user_id || '').trim() ||
    String(data?.payload?.for_user_id || '').trim() ||
    '';
  if (fromPayload) {
    return { botUserId: fromPayload, source: 'payload.for_user_id|filter.user_id' };
  }
  const env = String(params.envBotUserId || '').trim();
  if (env) return { botUserId: env, source: 'X_BOT_USER_ID' };
  const fromToken = userIdFromAccessToken(params.accessToken);
  if (fromToken) return { botUserId: fromToken, source: 'X_ACCESS_TOKEN prefix' };
  return { botUserId: null, source: 'missing' };
}

function collectEventArrays(body: Record<string, any>): {
  dmEvents: any[];
  typingEvents: any[];
  envelopeEventType: string | null;
  chatEvent: boolean;
  otherEventKeys: string[];
} {
  const data = asRecord(body.data);
  const inner = asRecord(data?.payload) || asRecord(body.payload) || body;
  const envelopeEventType =
    String(data?.event_type || body.event_type || inner.event_type || '').trim() ||
    null;

  const dmEvents = [
    ...asArray(body.direct_message_events),
    ...asArray(body.dm_events),
    ...asArray(data?.direct_message_events),
    ...asArray(data?.dm_events),
    ...asArray(inner.direct_message_events),
    ...asArray(inner.dm_events),
    ...asArray(inner.events),
  ];

  // XAA a veces manda un único evento en payload (sin array)
  if (
    dmEvents.length === 0 &&
    (inner.message_create || inner.sender_id || inner.text) &&
    envelopeEventType &&
    /dm\.|messagecreate|message_create/i.test(envelopeEventType)
  ) {
    dmEvents.push(inner);
  }

  const typingEvents = [
    ...asArray(body.direct_message_indicate_typing_events),
    ...asArray(inner.direct_message_indicate_typing_events),
    ...asArray(body.direct_message_mark_read_events),
    ...asArray(inner.direct_message_mark_read_events),
  ];

  const chatEvent =
    /^chat\./i.test(envelopeEventType || '') ||
    Boolean(inner.encoded_event) ||
    Boolean(inner.conversation_token);

  const known = new Set([
    'for_user_id',
    'direct_message_events',
    'dm_events',
    'direct_message_indicate_typing_events',
    'direct_message_mark_read_events',
    'users',
    'apps',
    'data',
    'payload',
    'event_type',
    'filter',
    'tag',
    'event_uuid',
  ]);
  const otherEventKeys = Object.keys(body).filter(
    (k) => !known.has(k) && /event/i.test(k),
  );

  return { dmEvents, typingEvents, envelopeEventType, chatEvent, otherEventKeys };
}

function normalizeEventType(raw: unknown): string {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
}

function extractText(event: any): string | null {
  const candidates = [
    event?.message_create?.message_data?.text,
    event?.message_data?.text,
    event?.text,
    event?.payload?.text,
  ];
  for (const c of candidates) {
    if (c != null && String(c).trim()) return String(c);
  }
  return event?.text != null ? String(event.text) : null;
}

function extractSenderId(event: any): string | null {
  const id =
    event?.message_create?.sender_id ??
    event?.sender_id ??
    event?.message_create?.sender?.id ??
    null;
  return id != null ? String(id) : null;
}

function extractRecipientId(event: any): string | null {
  const id =
    event?.message_create?.target?.recipient_id ??
    event?.target?.recipient_id ??
    event?.recipient_id ??
    null;
  return id != null ? String(id) : null;
}

function extractMessageId(event: any): string | null {
  const id = event?.id ?? event?.dm_event_id ?? event?.message_create?.id ?? null;
  return id != null ? String(id) : null;
}

export function parseIncomingDmsFromPayload(
  payload: unknown,
  botUserId?: string | null,
  envelopeEventType?: string | null,
): XIncomingDm[] {
  const body = asRecord(payload) || {};
  const { dmEvents, envelopeEventType: nestedType } = collectEventArrays(body);
  const envType = envelopeEventType || nestedType;
  const results: XIncomingDm[] = [];
  const seen = new Set<string>();

  for (const event of dmEvents) {
    const type = normalizeEventType(event?.type || event?.event_type || envType);
    if (type && !MESSAGE_CREATE_TYPES.has(type) && type !== 'dm.received' && type !== 'dm.sent') {
      if (!event?.message_create && extractText(event) == null) continue;
    }

    const senderId = extractSenderId(event);
    const recipientId = extractRecipientId(event);
    const text = extractText(event);
    const messageId = extractMessageId(event);
    const dedupe = messageId || `${senderId}:${text}`;
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);

    const sentByBot = Boolean(botUserId && senderId && senderId === String(botUserId));
    const envelopeType = normalizeEventType(envType);
    const isEcho = sentByBot || envelopeType === 'dm.sent' || envelopeType === 'chat.sent';

    if (!text && !senderId) continue;
    results.push({
      senderId,
      recipientId,
      text,
      messageId,
      isEcho,
      eventType: type || envType,
    });
  }

  return results;
}

export function summarizeXWebhookPayload(
  payload: Record<string, any>,
  parsed: XIncomingDm[],
): XWebhookSummary {
  const { dmEvents, typingEvents, envelopeEventType, chatEvent, otherEventKeys } =
    collectEventArrays(payload);
  const data = asRecord(payload.data);
  const forUserId =
    String(payload.for_user_id || data?.filter?.user_id || '').trim() || null;
  return {
    keys: Object.keys(payload || {}),
    forUserId,
    envelopeEventType,
    dmEventCount: dmEvents.length,
    typingEventCount: typingEvents.length,
    chatEvent,
    otherEventKeys,
    parsedDmCount: parsed.length,
    inboundCount: parsed.filter((m) => !m.isEcho).length,
    echoCount: parsed.filter((m) => m.isEcho).length,
    sampleTexts: parsed
      .map((m) => (m.text || '').slice(0, 80))
      .filter(Boolean)
      .slice(0, 3),
  };
}

export function truncateJson(value: unknown, maxChars = 6_000): string {
  try {
    const text = JSON.stringify(value);
    if (text.length <= maxChars) return text;
    return `${text.slice(0, maxChars)}…[truncated ${text.length - maxChars} chars]`;
  } catch {
    return String(value);
  }
}
