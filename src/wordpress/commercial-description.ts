type CadLike = Record<string, unknown>;

function sanitizeValue(v: unknown): string {
  if (v === undefined || v === null) return '';
  const s = String(v).trim();
  const lower = s.toLowerCase();
  if (
    lower === 'no especificado' ||
    lower === 'unknown' ||
    lower === 'undefined' ||
    lower === 'null' ||
    lower === ''
  ) {
    return '';
  }
  return s;
}

const TECHNICAL_DUMP_RE =
  /Detalles del Inmueble|Caracter[ií]sticas T[eé]cnicas|Ficha t[eé]cnica|<li><strong>Precio/i;

export function looksLikeTechnicalDump(html: unknown): boolean {
  const s = String(html ?? '').trim();
  if (!s) return false;
  return TECHNICAL_DUMP_RE.test(s);
}

export function pickExistingCommercialDescription(cad: CadLike | undefined): string {
  const candidates = [
    cad?.descripcion_propietario,
    cad?.descripcion_por_el_propietario,
    cad?.comentario_anunciante,
  ];
  for (const c of candidates) {
    const s = sanitizeValue(c);
    if (s && !looksLikeTechnicalDump(s) && s.length >= 40) return s;
  }
  return '';
}

export function buildFallbackCommercialDescription(
  cad: CadLike | undefined,
  callSummary?: string,
): string {
  const tipo = sanitizeValue(cad?.tipo_inmueble) || 'local comercial';
  const municipio = sanitizeValue(cad?.municipio);
  const via = [sanitizeValue(cad?.tipo_via), sanitizeValue(cad?.nombre_via)]
    .filter(Boolean)
    .join(' ');
  const ubicacion = [via, municipio].filter(Boolean).join(', ');
  const estado = sanitizeValue(cad?.estado);
  const negocio = sanitizeValue(cad?.negocio_anterior);
  const summary = sanitizeValue(callSummary);

  const where = ubicacion || 'una ubicación con buen potencial comercial';
  const hook = `<p><strong>Oportunidad de ${tipo} en ${municipio || 'zona comercial'}</strong></p>`;
  const body = `<p>Presentamos este ${tipo.toLowerCase()} en ${where}, un espacio versátil para impulsar tu próximo proyecto${negocio ? ` (uso anterior: ${negocio})` : ''}${estado ? `. El inmueble se encuentra en ${estado.toLowerCase()}` : ''}.</p>`;
  const close =
    '<p>Contacta con Localicer para agendar una visita y contrastar disponibilidad, condiciones y detalles con el anunciante.</p>';
  const extra =
    summary && !looksLikeTechnicalDump(summary) && summary.length > 60
      ? `<p>${summary}</p>`
      : '';

  return `${hook}\n${body}\n${extra}${close}`.trim();
}
