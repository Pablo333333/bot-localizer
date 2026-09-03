/** Columna K (1-based) = índice 0-based 10. */
export const COL_PROPIETARIO_CONTACTADO_INDEX0 = 10;

/** Valor escrito en "Propietario contactado?" (columna K) tras publicar en WordPress. */
export const COL_PROPIETARIO_CONTACTADO = 'Propietario contactado?';

export const WP_PUBLISH_CONTACTED_VALUE = 'SI';

export function buildWpPublishWritebackFields(
  postId: number | string,
): Record<string, string | number> {
  return {
    ID_WP: postId,
    'WP Post ID': postId,
    'Wp Post ID': postId,
    Referencia: postId,
    'Referencia / WP Post ID': postId,
    [COL_PROPIETARIO_CONTACTADO]: WP_PUBLISH_CONTACTED_VALUE,
  };
}
