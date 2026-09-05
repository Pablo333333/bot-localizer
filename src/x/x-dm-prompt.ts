/**
 * System prompt provisional para DMs de X.
 * Toni editará luego vía Sheets/DB; por ahora:
 * 1) X_DM_SYSTEM_PROMPT (env, multilínea o texto)
 * 2) Fallback genérico mínimo en código (no archivo .txt)
 */
export type XDmPromptSource = 'env:X_DM_SYSTEM_PROMPT' | 'fallback:generic';

export interface XDmPromptPayload {
  source: XDmPromptSource;
  prompt: string;
  /** Hint para Toni / producto — futura fuente Sheets/DB */
  editableVia: 'env_for_now_sheets_or_db_later';
}

const GENERIC_FALLBACK = `Eres Localisto, asistente de Localicer.com en mensajes directos de X.
Ayudas con locales comerciales (no viviendas). Respuestas cortas, una pregunta por mensaje, tono cercano en español.`;

export function loadLocalistoXDmSystemPrompt(
  envValue?: string | null,
): XDmPromptPayload {
  const fromEnv = (envValue ?? process.env.X_DM_SYSTEM_PROMPT ?? '')
    .trim()
    .replace(/\\n/g, '\n');

  if (fromEnv) {
    return {
      source: 'env:X_DM_SYSTEM_PROMPT',
      prompt: fromEnv,
      editableVia: 'env_for_now_sheets_or_db_later',
    };
  }

  return {
    source: 'fallback:generic',
    prompt: GENERIC_FALLBACK,
    editableVia: 'env_for_now_sheets_or_db_later',
  };
}
