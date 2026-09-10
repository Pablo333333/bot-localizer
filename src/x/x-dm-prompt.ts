/**
 * System prompt para DMs de X.
 * Fuente principal: Google Sheets (Toni edita sin tocar Railway).
 * Orden: Sheets → env legacy → fallback genérico en código.
 */
export const X_DM_PROMPT_SHEET = 'Config_X';
/** Celda con el texto completo del system prompt (multilínea OK). */
export const X_DM_PROMPT_CELL = 'B2';

export type XDmPromptSource =
  | 'sheets:Config_X!B2'
  | 'env:X_DM_SYSTEM_PROMPT'
  | 'fallback:generic';

export interface XDmPromptPayload {
  source: XDmPromptSource;
  prompt: string;
  /** Dónde editar el prompt en producción */
  editableVia: 'sheets:Config_X!B2';
}

const SHEETS_SOURCE = 'sheets:Config_X!B2' as const;

const GENERIC_FALLBACK = `Eres Localisto, asistente de Localicer.com en mensajes directos de X.
Ayudas con locales comerciales (no viviendas). Respuestas cortas, una pregunta por mensaje, tono cercano en español.`;

export function resolveXDmSystemPrompt(options: {
  sheetsText?: string | null;
  envValue?: string | null;
}): XDmPromptPayload {
  const fromSheets = (options.sheetsText ?? '').trim().replace(/\\n/g, '\n');
  if (fromSheets) {
    return {
      source: SHEETS_SOURCE,
      prompt: fromSheets,
      editableVia: SHEETS_SOURCE,
    };
  }

  const fromEnv = (options.envValue ?? process.env.X_DM_SYSTEM_PROMPT ?? '')
    .trim()
    .replace(/\\n/g, '\n');
  if (fromEnv) {
    return {
      source: 'env:X_DM_SYSTEM_PROMPT',
      prompt: fromEnv,
      editableVia: SHEETS_SOURCE,
    };
  }

  return {
    source: 'fallback:generic',
    prompt: GENERIC_FALLBACK,
    editableVia: SHEETS_SOURCE,
  };
}

/** @deprecated Usar resolveXDmSystemPrompt; se mantiene por compatibilidad de tests. */
export function loadLocalistoXDmSystemPrompt(
  envValue?: string | null,
): XDmPromptPayload {
  return resolveXDmSystemPrompt({ envValue });
}
