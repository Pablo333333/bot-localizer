import { isPublicacionAutorizadaSi } from '../../outbound/publicacion-autorizada';
import { readWpPostIdFromSheetRow } from '../../wordpress/sheet-row-mapper';

type SheetRowLike = { get: (header: string) => unknown };

/**
 * El anunciante ya está gestionado a mano: Publicación Autorizada? = SI,
 * o la fila ya tiene ficha publicada (WP Post ID).
 * Cualquiera de las dos corta la secuencia para que no salga otra llamada.
 */
export function alreadyHandledAdReason(
  row: SheetRowLike,
  headerValues?: string[],
): string | null {
  if (isPublicacionAutorizadaSi(row, headerValues)) {
    return 'publicacion_autorizada';
  }
  const postId = readWpPostIdFromSheetRow(row);
  if (postId && postId > 0) {
    return `wp_post_id:${postId}`;
  }
  return null;
}
