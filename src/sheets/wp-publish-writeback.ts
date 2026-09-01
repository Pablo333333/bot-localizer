/** Valor escrito en "Publicado Popalicer?" tras publicar en WordPress. */
export const COL_PUBLICADO_POPALICER = 'Publicado Popalicer?';

const PUBLICADO_ALIASES = new Set(['si', 'sí', 'publicado', 'yes', 'true', '1']);

/**
 * Normaliza el valor de write-back (env o default SI).
 * Acepta SI, PUBLICADO, Si (dropdown del Sheet), etc.
 */
export function resolvePublicadoPopalicerWriteValue(
  raw?: string | null,
): string {
  const value = String(raw ?? 'SI').trim();
  if (!value) return 'SI';
  const lower = value.toLowerCase();
  if (lower === 'si' || lower === 'sí') return 'SI';
  if (lower === 'publicado') return 'PUBLICADO';
  if (PUBLICADO_ALIASES.has(lower)) return value.toUpperCase();
  return value;
}

export function buildWpPublishWritebackFields(
  postId: number | string,
  publicadoValue: string,
): Record<string, string | number> {
  return {
    ID_WP: postId,
    'WP Post ID': postId,
    'Wp Post ID': postId,
    Referencia: postId,
    'Referencia / WP Post ID': postId,
    [COL_PUBLICADO_POPALICER]: publicadoValue,
  };
}
