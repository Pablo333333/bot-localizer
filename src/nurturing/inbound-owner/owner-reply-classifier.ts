import type {
  OwnerReplyClassifyResult,
  OwnerReplyIntent,
} from './owner-reply.types';

/**
 * Clasificador heurístico (tests / dry-run local sin OpenAI).
 * Prioridad: NO_CONTACTAR > NO_DISPONIBLE > NO_INTERESADO > DISPONIBLE > AMBIGUO.
 */
export function classifyOwnerReplyHeuristic(
  message: string,
): OwnerReplyClassifyResult {
  const text = String(message || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

  if (!text) {
    return {
      intent: 'AMBIGUO',
      confidence: 0.2,
      reason: 'mensaje_vacio',
    };
  }

  const noContact =
    /\b(no\s+me\s+(llames|llameis|escribas|escribais|contactes|contacteis)|no\s+contactar|deja\s+de\s+(llamar|escribir|contactar)|baja|opt[\s-]?out|stop)\b/.test(
      text,
    );
  if (noContact) {
    return {
      intent: 'NO_CONTACTAR',
      confidence: 0.92,
      reason: 'heuristic_no_contactar',
      motive: message.trim().slice(0, 240),
    };
  }

  const unavailable =
    /\b(vendido|vendida|alquilado|alquilada|traspasado|traspasada|ya\s+no\s+esta\s+disponible|no\s+disponible|ocupado|cerrado\s+el\s+local)\b/.test(
      text,
    );
  if (unavailable) {
    return {
      intent: 'NO_DISPONIBLE',
      confidence: 0.9,
      reason: 'heuristic_no_disponible',
      motive: message.trim().slice(0, 240),
    };
  }

  const notInterested =
    /\b(no\s+me\s+interesa|no\s+quiero\s+(publicar|usar|el\s+servicio)|no\s+gracias|paso\s+del\s+servicio|no\s+estoy\s+interesado)\b/.test(
      text,
    );
  if (notInterested) {
    return {
      intent: 'NO_INTERESADO',
      confidence: 0.88,
      reason: 'heuristic_no_interesado',
      motive: message.trim().slice(0, 240),
    };
  }

  const available =
    /\b(sigue\s+disponible|esta\s+disponible|disponible|aun\s+disponible|todavia\s+disponible|si[,.]?\s*disponible)\b/.test(
      text,
    );
  if (available) {
    return {
      intent: 'DISPONIBLE',
      confidence: 0.85,
      reason: 'heuristic_disponible',
      motive: message.trim().slice(0, 240),
    };
  }

  return {
    intent: 'AMBIGUO',
    confidence: 0.4,
    reason: 'heuristic_ambiguo',
    motive: message.trim().slice(0, 240),
  };
}

const INTENT_SET = new Set<OwnerReplyIntent>([
  'NO_DISPONIBLE',
  'DISPONIBLE',
  'NO_INTERESADO',
  'NO_CONTACTAR',
  'AMBIGUO',
]);

export function parseOwnerReplyLlmJson(
  raw: string,
): OwnerReplyClassifyResult | null {
  try {
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start < 0 || end <= start) return null;
    const parsed = JSON.parse(raw.slice(start, end + 1)) as Record<
      string,
      unknown
    >;
    const intent = String(parsed.intent || '')
      .trim()
      .toUpperCase() as OwnerReplyIntent;
    if (!INTENT_SET.has(intent)) return null;
    const confidence = Number(parsed.confidence);
    return {
      intent,
      confidence: Number.isFinite(confidence)
        ? Math.min(1, Math.max(0, confidence))
        : 0.5,
      reason: String(parsed.reason || 'llm').slice(0, 120),
      motive: String(parsed.motive || parsed.reason || '').slice(0, 240),
    };
  } catch {
    return null;
  }
}

export const OWNER_REPLY_LLM_SYSTEM = `Eres un clasificador de respuestas de anunciantes inmobiliarios por WhatsApp.
Devuelve SOLO JSON:
{"intent":"NO_DISPONIBLE|DISPONIBLE|NO_INTERESADO|NO_CONTACTAR|AMBIGUO","confidence":0-1,"reason":"...","motive":"..."}

Definiciones:
- NO_DISPONIBLE: vendido, alquilado, traspasado, ya no disponible.
- DISPONIBLE: confirma que el inmueble sigue disponible.
- NO_INTERESADO: no quiere publicar/usar el servicio, pero no dice que el inmueble no esté disponible.
- NO_CONTACTAR: pide no volver a llamar ni escribir (opt-out).
- AMBIGUO: no está claro o mezcla intenciones.`;
