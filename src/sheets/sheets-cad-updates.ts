/**
 * Updates celda-a-celda desde CAD de Retell.
 * Solo se escribe si el valor extraído es no vacío y distinto del original.
 */

export type CadLike = Record<string, unknown> | undefined;

const EMPTY_TOKENS = new Set([
  '',
  'no especificado',
  'unknown',
  'undefined',
  'null',
  'n/a',
  'na',
]);

const ESTADO_OPTIONS = [
  'En construcción',
  'Nuevo',
  'Reformado',
  'Buen estado',
  'Buena conservación',
  'Segunda mano - por Reformar',
];

const CERT_OPTIONS = [
  'No consta',
  'Exento',
  'En tramite',
  'A',
  'B',
  'C',
  'D',
  'F',
  'G',
];

export function sanitizeCadValue(
  v: unknown,
  cleanSymbols = false,
): string {
  if (v === undefined || v === null) return '';
  let s = String(v).trim();
  if (EMPTY_TOKENS.has(s.toLowerCase())) return '';
  if (cleanSymbols) {
    s = s.replace(/[€$m²\s]/g, '');
    if (s.includes('.') && s.includes(',')) {
      s = s.replace(/\./g, '').replace(',', '.');
    } else if (s.includes(',')) {
      s = s.replace(',', '.');
    } else if (
      s.includes('.') &&
      s.length > 3 &&
      s.indexOf('.') === s.lastIndexOf('.')
    ) {
      const parts = s.split('.');
      if (parts[1]?.length === 3) {
        s = s.replace('.', '');
      }
    }
  }
  return s.trim();
}

function parseNumericLoose(s: string): number | null {
  const cleaned = sanitizeCadValue(s, true);
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function yesNoExplicit(v: unknown): 'SI' | 'NO' | '' {
  const s = String(v ?? '')
    .toUpperCase()
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  if (!s || EMPTY_TOKENS.has(s.toLowerCase())) return '';
  if (['SI', 'TRUE', '1', 'YES'].includes(s)) return 'SI';
  if (['NO', 'FALSE', '0'].includes(s)) return 'NO';
  return '';
}

function matchOption(v: unknown, options: string[]): string {
  const s = sanitizeCadValue(v);
  if (!s) return '';
  const found = options.find(
    (opt) => opt.toLowerCase() === s.toLowerCase(),
  );
  return found || s;
}

/** Compara original vs extraído: números, SI/NO y texto (case-insensitive). */
export function valuesAreEquivalent(existing: unknown, incoming: unknown): boolean {
  const a = String(existing ?? '').trim();
  const b = String(incoming ?? '').trim();
  if (a === b) return true;
  if (!a && !b) return true;
  if (!a || !b) return false;

  const aYes = yesNoExplicit(a);
  const bYes = yesNoExplicit(b);
  if (aYes && bYes) return aYes === bYes;

  const na = parseNumericLoose(a);
  const nb = parseNumericLoose(b);
  if (na !== null && nb !== null) return na === nb;

  return a.toLowerCase() === b.toLowerCase();
}

/**
 * true → escribir la celda.
 * Vacío extraído → false (se conserva el original).
 * Igual al original → false.
 * Original vacío + extraído con dato → true.
 */
export function shouldWriteCell(existing: unknown, incoming: unknown): boolean {
  const next = sanitizeCadValue(incoming);
  if (!next) return false;
  return !valuesAreEquivalent(existing, next);
}

function pickIfChanged(
  out: Record<string, string>,
  header: string,
  incoming: string,
  getExisting: (header: string) => unknown,
): void {
  if (!incoming) return;
  if (!shouldWriteCell(getExisting(header), incoming)) return;
  out[header] = incoming;
}

/**
 * Mapea CAD Retell → columnas de inmueble, solo deltas no vacíos.
 */
export function buildCadPropertyUpdates(
  cad: CadLike,
  getExisting: (header: string) => unknown,
): Record<string, string> {
  const out: Record<string, string> = {};
  if (!cad) return out;

  const val = (v: unknown, cleanSymbols = false) =>
    sanitizeCadValue(v, cleanSymbols);

  pickIfChanged(out, 'Tipo de inmueble', val(cad.tipo_inmueble), getExisting);
  pickIfChanged(
    out,
    'Disponibilidad del local',
    val(cad.disponibilidad),
    getExisting,
  );
  pickIfChanged(
    out,
    'Información adicional',
    val(cad.informacion_adicional || cad.info_adicional),
    getExisting,
  );
  pickIfChanged(out, 'Superficie Total', val(cad.superficie_total, true), getExisting);
  pickIfChanged(out, 'Superficie util', val(cad.superficie_util, true), getExisting);
  pickIfChanged(out, 'Negocio anterior', val(cad.negocio_anterior), getExisting);
  pickIfChanged(out, 'Estado', matchOption(cad.estado, ESTADO_OPTIONS), getExisting);
  pickIfChanged(out, 'Año de construcción', val(cad.anio_construccion), getExisting);
  pickIfChanged(out, 'Año reforma', val(cad.anio_reforma), getExisting);
  pickIfChanged(
    out,
    'Numero aseos/baños',
    val(cad.numero_banios || cad.numero_aseos || cad.aseos, true),
    getExisting,
  );
  pickIfChanged(out, 'Posición exacta', val(cad.posicion_exacta), getExisting);
  pickIfChanged(out, 'Escaparates/ventanales', val(cad.escaparates), getExisting);
  pickIfChanged(
    out,
    'Diafano?',
    val(cad['disposicion_diafano?'] || cad.disposicion_diafano),
    getExisting,
  );
  pickIfChanged(out, 'Eventos', val(cad.eventos), getExisting);
  pickIfChanged(
    out,
    'Almacen/trastienda (m2)',
    val(cad.almacen_trastienda, true),
    getExisting,
  );
  pickIfChanged(
    out,
    'Terraza propia (Superficie m2)',
    val(cad.terraza_patio, true),
    getExisting,
  );
  pickIfChanged(out, 'Equipamiento', val(cad.equipamiento), getExisting);
  pickIfChanged(
    out,
    'Certificación energética',
    matchOption(cad.certificado_energetico || cad.certificacion, CERT_OPTIONS),
    getExisting,
  );
  pickIfChanged(out, 'Aforo máximo', val(cad.aforo_maximo, true), getExisting);
  pickIfChanged(out, 'Limpieza', val(cad.limpieza), getExisting);
  pickIfChanged(out, 'Tipo Via', val(cad.tipo_via), getExisting);
  pickIfChanged(out, 'Nombre via', val(cad.nombre_via), getExisting);
  pickIfChanged(
    out,
    'Numero Via',
    val(cad.numero_via || cad.altura),
    getExisting,
  );
  pickIfChanged(
    out,
    'Pueblo/Barrio/distrito',
    val(cad.pueblo_barrio || cad.pueblo),
    getExisting,
  );
  pickIfChanged(out, 'Municipio', val(cad.municipio), getExisting);
  pickIfChanged(out, 'Provincia', val(cad.provincia), getExisting);
  pickIfChanged(out, 'Precio VENTA', val(cad.precio_venta, true), getExisting);
  pickIfChanged(out, 'Precio TRASPASO', val(cad.precio_traspaso, true), getExisting);
  pickIfChanged(
    out,
    'Precio ALQUILER/mes',
    val(cad.precio_alquiler, true),
    getExisting,
  );
  pickIfChanged(
    out,
    'Fianza',
    val(cad.fianza_meses || cad.fianza, true),
    getExisting,
  );
  pickIfChanged(
    out,
    'Gastos de comunidad',
    val(cad.gastos_comunidad, true),
    getExisting,
  );
  pickIfChanged(out, 'Negociable', val(cad.es_negociable), getExisting);
  pickIfChanged(out, 'Vado (SI/NO)', yesNoExplicit(cad.vado), getExisting);
  pickIfChanged(out, 'Altura techos', val(cad.altura_techos), getExisting);
  pickIfChanged(out, 'Numero plantas', val(cad.num_plantas), getExisting);
  pickIfChanged(out, 'Iluminacion', val(cad.iluminacion), getExisting);
  pickIfChanged(out, 'Suelos', val(cad.suelos), getExisting);
  pickIfChanged(out, 'Contrato', val(cad.contrato), getExisting);
  pickIfChanged(out, 'Ilocalizable', val(cad.Ilocalizable), getExisting);
  pickIfChanged(
    out,
    'Email propietario-gestor',
    val(cad.email_propietario_gestor || cad.email),
    getExisting,
  );
  pickIfChanged(out, 'Email Avisos', val(cad.email_avisos), getExisting);
  pickIfChanged(
    out,
    'Publicacion Autorizada?',
    yesNoExplicit(cad.publicacion_autorizada),
    getExisting,
  );

  const target = String(cad.target_contact || '').trim();
  if (target === 'contacto_1') {
    pickIfChanged(out, 'Nombre contacto1', val(cad.nombre_contacto_1), getExisting);
    pickIfChanged(out, 'Contacto1 con', val(cad.contacto_1_con), getExisting);
    pickIfChanged(out, 'Contacto1 por', val(cad.contacto_1_por), getExisting);
  } else if (target === 'contacto_2') {
    pickIfChanged(out, 'Nombre contacto2', val(cad.nombre_contacto_2), getExisting);
    pickIfChanged(out, 'Contacto2 con', val(cad.contacto_2_con), getExisting);
    pickIfChanged(out, 'Contacto2 por', val(cad.contacto_2_por), getExisting);
  } else if (target === 'contacto_3') {
    pickIfChanged(out, 'Nombre contacto3', val(cad.nombre_contacto_3), getExisting);
    pickIfChanged(out, 'Contacto3 con', val(cad.contacto_3_con), getExisting);
    pickIfChanged(out, 'Contacto3 por', val(cad.contacto_3_por), getExisting);
  }

  return out;
}
