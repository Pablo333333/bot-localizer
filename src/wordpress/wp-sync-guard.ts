/**
 * Protección de anuncios ya publicados / editados en WordPress frente a sync automático.
 *
 * Reglas:
 * - Si el post WP está en `publish` y WP_SYNC_PROTECT_PUBLISHED≠false → no sobrescribir
 *   salvo que el Sheet tenga "Forzar sync WP"=SI o el caller pase force=true.
 * - Si el Sheet tiene "Bloquear sync WP"=SI → nunca sobrescribir (ni con force de cron).
 */

export const COL_FORZAR_SYNC_WP = 'Forzar sync WP';
export const COL_BLOQUEAR_SYNC_WP = 'Bloquear sync WP';

export function normalizeSiToken(raw: unknown): string {
  return String(raw ?? '')
    .trim()
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

export function isSiCell(raw: unknown): boolean {
  return normalizeSiToken(raw) === 'SI';
}

export function readForzarSyncWp(row: {
  get: (header: string) => unknown;
}): boolean {
  return (
    isSiCell(row.get(COL_FORZAR_SYNC_WP)) ||
    isSiCell(row.get('Forzar Sync WP')) ||
    isSiCell(row.get('forzar_sync_wp'))
  );
}

export function readBloquearSyncWp(row: {
  get: (header: string) => unknown;
}): boolean {
  return (
    isSiCell(row.get(COL_BLOQUEAR_SYNC_WP)) ||
    isSiCell(row.get('Bloquear Sync WP')) ||
    isSiCell(row.get('bloquear_sync_wp'))
  );
}

export function isWpSyncProtectPublishedEnabled(
  raw?: string | boolean | null,
): boolean {
  if (raw === false) return false;
  if (raw === true || raw == null || String(raw).trim() === '') return true;
  const v = String(raw).trim().toLowerCase();
  return !['false', '0', 'no', 'off'].includes(v);
}

/**
 * Decide si un upsert debe omitirse para proteger ediciones manuales / publicados.
 */
export function shouldSkipWpOverwrite(params: {
  existingPostId?: number;
  wpStatus?: string | null;
  protectPublished: boolean;
  forzarSync: boolean;
  bloquearSync: boolean;
}): { skip: boolean; reason?: string } {
  if (!params.existingPostId) {
    return { skip: false };
  }
  if (params.bloquearSync) {
    return {
      skip: true,
      reason: `post ${params.existingPostId} bloqueado (Bloquear sync WP=SI)`,
    };
  }
  const status = String(params.wpStatus || '').toLowerCase();
  if (
    params.protectPublished &&
    status === 'publish' &&
    !params.forzarSync
  ) {
    return {
      skip: true,
      reason: `post ${params.existingPostId} ya publicado — sync omitido (pon Forzar sync WP=SI para autorizar)`,
    };
  }
  return { skip: false };
}
