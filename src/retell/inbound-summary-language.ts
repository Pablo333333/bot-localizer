/**
 * El agente outbound ya resume en español. El inbound usa el prompt por defecto
 * (inglés) salvo que, al entrar la llamada, le forcemos el análisis en español.
 * Retell aplica este override al generar call_summary cuando la llamada termina.
 */

export const RETELL_API_BASE = 'https://api.retellai.com';

export type RetellHttpResult =
  | { ok: true; body: Record<string, unknown> | null }
  | { ok: false; retry: boolean; message: string };

/**
 * Retell a veces responde 200/204 con cuerpo vacío y Content-Type JSON.
 * `response.json()` del SDK lanza "Unexpected end of JSON input".
 * Un 2xx vacío es éxito en update/publish; en un GET que necesita el agente, se reintenta.
 */
export function interpretRetellHttpResponse(args: {
  status: number;
  rawBody: string;
  requireJsonBody: boolean;
}): RetellHttpResult {
  const raw = args.rawBody.trim();
  const success = args.status >= 200 && args.status < 300;

  if (success && (args.status === 204 || raw === '')) {
    if (args.requireJsonBody) {
      return {
        ok: false,
        retry: true,
        message: `Retell HTTP ${args.status} con cuerpo vacío`,
      };
    }
    return { ok: true, body: null };
  }

  if (args.status === 429 || args.status >= 500) {
    return {
      ok: false,
      retry: true,
      message: `Retell HTTP ${args.status}${raw ? `: ${raw.slice(0, 240)}` : ''}`,
    };
  }

  if (!success) {
    return {
      ok: false,
      retry: false,
      message: `Retell HTTP ${args.status}${raw ? `: ${raw.slice(0, 240)}` : ''}`,
    };
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return { ok: true, body: parsed as Record<string, unknown> };
    }
    return { ok: true, body: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      retry: true,
      message: `JSON inválido de Retell: ${message}`,
    };
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Lee el cuerpo como texto. Reintenta red, 429, 5xx y JSON vacío o inválido. */
export async function retellRequest(args: {
  fetchImpl: typeof fetch;
  apiKey: string;
  method: 'GET' | 'PATCH' | 'POST';
  path: string;
  jsonBody?: unknown;
  requireJsonBody: boolean;
  attempts?: number;
  sleep?: (ms: number) => Promise<void>;
}): Promise<Record<string, unknown> | null> {
  const attempts = Math.max(1, args.attempts ?? 3);
  const wait = args.sleep ?? sleep;
  let last = 'sin respuesta de Retell';

  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const response = await args.fetchImpl(`${RETELL_API_BASE}${args.path}`, {
        method: args.method,
        headers: {
          Authorization: `Bearer ${args.apiKey}`,
          Accept: 'application/json',
          ...(args.jsonBody !== undefined
            ? { 'Content-Type': 'application/json' }
            : {}),
        },
        body:
          args.jsonBody !== undefined ? JSON.stringify(args.jsonBody) : undefined,
      });
      const rawBody = await response.text();
      const interpreted = interpretRetellHttpResponse({
        status: response.status,
        rawBody,
        requireJsonBody: args.requireJsonBody,
      });
      if (interpreted.ok) return interpreted.body;
      last = interpreted.message;
      if (!interpreted.retry || attempt === attempts - 1) {
        throw new Error(last);
      }
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
      const alreadyFinal = /Retell HTTP 4(?!29)/.test(last);
      if (alreadyFinal || attempt === attempts - 1) {
        throw new Error(last);
      }
    }
    await wait(400 * (attempt + 1));
  }

  throw new Error(last);
}

export const INBOUND_SPANISH_SUMMARY_PROMPT =
  'Redacta call_summary ÚNICAMENTE en español de España. ' +
  'Prohibido el inglés y cualquier otro idioma, aunque la llamada haya tenido palabras sueltas en inglés. ' +
  'En 2 a 4 frases: quién llamó, qué inmueble o consulta trató, el resultado y el siguiente paso si lo hubo. ' +
  'Si no hubo conversación útil, dilo en español.';

export function buildInboundSpanishSummaryOverride(): {
  call_inbound: {
    agent_override: {
      agent: {
        language: 'es-ES';
        analysis_summary_prompt: string;
        post_call_analysis_data: Array<{
          type: 'system-presets';
          name: 'call_summary';
          description: string;
        }>;
      };
    };
  };
} {
  return {
    call_inbound: {
      agent_override: {
        agent: {
          language: 'es-ES',
          analysis_summary_prompt: INBOUND_SPANISH_SUMMARY_PROMPT,
          post_call_analysis_data: [
            {
              type: 'system-presets',
              name: 'call_summary',
              description: INBOUND_SPANISH_SUMMARY_PROMPT,
            },
          ],
        },
      },
    },
  };
}
