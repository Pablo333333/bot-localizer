/**
 * Un anuncio nuevo no debe crearse en pending solo porque el Sheet diga
 * Publicación Autorizada, si hubo una llamada y el propietario no quedó contactado.
 * Una ficha sin Call ID es revisión manual y sí puede publicarse.
 */

function normalizeToken(raw: unknown): string {
  return String(raw ?? '')
    .trim()
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

const NOT_CONTACTED = new Set([
  '',
  'NO',
  'FALSE',
  '0',
  'PENDIENTE',
  'NO CONTACTADO',
  'ILOCALIZABLE',
]);

/** Fecha o SI: la llamada (o la ficha) dejó constancia de contacto válido. */
export function isOwnerContactRecorded(raw: unknown): boolean {
  return !NOT_CONTACTED.has(normalizeToken(raw));
}

export function shouldAutoCreateWpListing(args: {
  callId?: unknown;
  propietarioContactado?: unknown;
  force?: boolean;
}): boolean {
  if (args.force) return true;
  const callId = String(args.callId ?? '').trim();
  if (!callId) return true;
  return isOwnerContactRecorded(args.propietarioContactado);
}
