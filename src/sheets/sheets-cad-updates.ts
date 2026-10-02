/**
 * Updates celda-a-celda desde CAD de Retell.
 * Nunca se pisa un valor ya guardado con vacío, cero o texto genérico de relleno.
 */

import {
  findOperacionHeader,
  findTraspasoModalidadHeader,
  formatOperationCell,
  parseTraspasoModalidad,
} from './sheet-operation-headers';

export type CadLike = Record<string, unknown> | undefined;

const EMPTY_TOKENS = new Set([
  '',
  'no especificado',
  'no especificada',
  'sin especificar',
  'sin datos',
  'sin dato',
  'sin informacion',
  'sin información',
  'informacion no disponible',
  'información no disponible',
  'no disponible',
  'no indicado',
  'no indicada',
  'no mencionado',
  'no mencionada',
  'no se menciona',
  'no se menciono',
  'no se mencionó',
  'no proporcionado',
  'dato no proporcionado',
  'desconocido',
  'desconocida',
  'unknown',
  'undefined',
  'null',
  'n/a',
  'na',
  'n/d',
  'nd',
  's/d',
  's/n',
  'tbd',
  'pendiente de confirmar',
  'por determinar',
  'por confirmar',
  'a consultar',
  'placeholder',
  'lorem ipsum',
  'texto de ejemplo',
  'texto generico',
  'texto genérico',
  'ejemplo',
  'generico',
  'genérico',
  'prueba',
  'test',
  '-',
  '--',
  '---',
  'n/c',
  'nc',
  'none',
  'ninguno',
  'ninguna',
  'indeterminado',
  'indeterminada',
  'interesado_ia',
  'false',
  'falso',
  'no aplica',
  'no procede',
]);

const FILLER_PATTERNS: RegExp[] = [
  /contacta con localicer para agendar/i,
  /una ubicacion con buen potencial comercial/i,
  /oportunidad de .+ en zona comercial/i,
  /^no se (especific|indic|mencion|dispon|proporcion)/i,
  /^sin (datos|informacion|especificar)/i,
  /lorem ipsum/i,
  /texto (generico|de relleno|de ejemplo)/i,
  /dato (inventado|no proporcionado|no disponible)/i,
];

function foldToken(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

/** 0, 0.0, 0,00, "0 €" o "0 m²". Un cero no es un dato analizado válido. */
export function isNumericZeroValue(v: unknown): boolean {
  let s = String(v ?? '')
    .trim()
    .replace(/[€$]/g, '')
    .replace(/m²|m2/gi, '')
    .replace(/\s/g, '');
  if (!s) return false;
  if (s.includes('.') && s.includes(',')) {
    s = s.replace(/\./g, '').replace(',', '.');
  } else if (s.includes(',')) {
    s = s.replace(',', '.');
  }
  if (!/^-?\d+(\.\d+)?$/.test(s)) return false;
  const n = Number(s);
  return Number.isFinite(n) && n === 0;
}

/**
 * Texto de relleno o alucinación típica del análisis (no un dato de ficha).
 * No marca descripciones reales del anunciante.
 */
export function isGenericFillerText(v: unknown): boolean {
  const raw = String(v ?? '').trim();
  if (!raw) return false;
  const folded = foldToken(raw);
  const plain = folded.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  if (EMPTY_TOKENS.has(folded) || EMPTY_TOKENS.has(plain)) return true;
  return FILLER_PATTERNS.some((re) => re.test(plain));
}

/** Vacío, cero o relleno: no debe escribirse encima de la celda. */
export function isInvalidAnalyzedValue(v: unknown): boolean {
  if (v === undefined || v === null) return true;
  if (String(v).trim() === '') return true;
  if (isNumericZeroValue(v)) return true;
  if (isGenericFillerText(v)) return true;
  return false;
}

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
  if (isInvalidAnalyzedValue(v)) return '';
  let s = String(v).trim();
  if (EMPTY_TOKENS.has(s.toLowerCase()) || EMPTY_TOKENS.has(foldToken(s))) {
    return '';
  }
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
    if (!/^\d+(\.\d+)?$/.test(s) || Number(s) === 0) return '';
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
  if (!s || EMPTY_TOKENS.has(s.toLowerCase()) || isNumericZeroValue(s)) return '';
  if (['SI', 'TRUE', '1', 'YES'].includes(s)) return 'SI';
  if (['NO', 'FALSE'].includes(s)) return 'NO';
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
  if (isInvalidAnalyzedValue(incoming)) return false;
  const next = sanitizeCadValue(incoming);
  if (!next) return false;
  const prev = String(existing ?? '').trim();
  if (prev && isInvalidAnalyzedValue(next)) return false;
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
  headers?: readonly string[],
): Record<string, string> {
  const out: Record<string, string> = {};
  if (!cad) return out;

  const val = (v: unknown, cleanSymbols = false) =>
    sanitizeCadValue(v, cleanSymbols);

  pickIfChanged(out, 'Tipo de inmueble', val(cad.tipo_inmueble), getExisting);
  const operacionHeader = findOperacionHeader(headers) || 'Operación';
  pickIfChanged(
    out,
    operacionHeader,
    formatOperationCell(cad.contrato || cad.operacion),
    getExisting,
  );
  const modalidadHeader =
    findTraspasoModalidadHeader(headers) || 'Modalidad de Traspaso';
  pickIfChanged(
    out,
    modalidadHeader,
    parseTraspasoModalidad(cad.modalidad_traspaso || cad.traspaso),
    getExisting,
  );
  pickIfChanged(
    out,
    'Información adicional',
    val(cad.informacion_adicional || cad.info_adicional),
    getExisting,
  );
  pickIfChanged(
    out,
    'Descripción por el propietario',
    val(
      cad.descripcion_generada ||
        cad.descripcion_propietario ||
        cad.descripcion_por_el_propietario ||
        cad.comentario_anunciante,
    ),
    getExisting,
  );
  pickIfChanged(out, 'Superficie Total', val(cad.superficie_total, true), getExisting);
  pickIfChanged(out, 'Superficie util', val(cad.superficie_util, true), getExisting);
  pickIfChanged(out, 'Negocio anterior', val(cad.negocio_anterior), getExisting);
  // Estado se escribe más abajo (evita pipeline lead: pendiente/ilocalizable).
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
    val(cad.terraza_patio),
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
  pickIfChanged(out, 'Numero plantas', val(cad.numero_plantas || cad.num_plantas), getExisting);
  pickIfChanged(
    out,
    'Numero de entradas y accesos',
    val(
      cad['Numero de entradas y accesos'] ||
        cad.numero_entradas ||
        cad.numero_de_entradas ||
        cad.entradas,
    ),
    getExisting,
  );
  pickIfChanged(out, 'Iluminacion', val(cad.iluminacion), getExisting);
  pickIfChanged(out, 'Suelos', val(cad.suelos), getExisting);
  pickIfChanged(out, 'Ilocalizable', val(cad.Ilocalizable), getExisting);
  pickIfChanged(
    out,
    'Email propietario-gestor',
    val(cad.email_propietario_gestor || cad.email),
    getExisting,
  );
  pickIfChanged(out, 'Email Avisos', val(cad.email || cad.email_avisos), getExisting);
  pickIfChanged(
    out,
    'Publicacion Autorizada?',
    yesNoExplicit(cad['publicacion_autorizada?'] || cad.publicacion_autorizada),
    getExisting,
  );

  // URL / carpeta Drive corregidas en llamada → Sheet (fuente para sync WP).
  pickIfChanged(
    out,
    'URL imagen',
    val(
      cad.url_imagen ||
        cad.imagen_url ||
        cad.imagen_drive ||
        cad.google_drive_url ||
        cad.drive_url,
    ),
    getExisting,
  );
  pickIfChanged(
    out,
    'Carpeta Drive',
    val(
      cad.carpeta_drive ||
        cad.drive_folder_id ||
        cad.drive_folder ||
        cad.google_drive_folder,
    ),
    getExisting,
  );

  const target = String(cad.target_contact || '').trim();
  if (target === 'contacto_1') {
    pickIfChanged(out, 'Nombre contacto1', val(cad.nombre_contacto_1 || cad.nombre_contacto), getExisting);
    pickIfChanged(out, 'Contacto1 con', val(cad.contacto_1_con), getExisting);
    pickIfChanged(out, 'Contacto1 por', val(cad.contacto_1_por), getExisting);
  } else if (target === 'contacto_2') {
    pickIfChanged(out, 'Nombre contacto2', val(cad.nombre_contacto_2 || cad.nombre_contacto), getExisting);
    pickIfChanged(out, 'Contacto2 con', val(cad.contacto_2_con), getExisting);
    pickIfChanged(out, 'Contacto2 por', val(cad.contacto_2_por), getExisting);
  } else if (target === 'contacto_3') {
    pickIfChanged(out, 'Nombre contacto3', val(cad.nombre_contacto_3 || cad.nombre_contacto), getExisting);
    pickIfChanged(out, 'Contacto3 con', val(cad.contacto_3_con), getExisting);
    pickIfChanged(out, 'Contacto3 por', val(cad.contacto_3_por), getExisting);
  } else {
    // Sin target_contact: aplicar correcciones genéricas al contacto principal.
    pickIfChanged(
      out,
      'Nombre contacto1',
      val(
        cad.nombre_contacto_1 ||
          cad.nombre_contacto ||
          cad.nombre_propietario ||
          cad.first_name,
      ),
      getExisting,
    );
    pickIfChanged(out, 'Contacto1 por', val(cad.contacto_1_por), getExisting);
    pickIfChanged(out, 'Contacto1 con', val(cad.contacto_1_con), getExisting);
    pickIfChanged(out, 'Nombre contacto2', val(cad.nombre_contacto_2), getExisting);
    pickIfChanged(out, 'Nombre contacto3', val(cad.nombre_contacto_3), getExisting);
  }

  // Estado del inmueble (Buen estado, Nuevo, Reformado…).
  // "Nuevo" es una opción de ficha. Pendiente, ilocalizable o interesado no lo son.
  const rawEstado = sanitizeCadValue(cad.estado);
  const catalogEstado = ESTADO_OPTIONS.find(
    (opt) => opt.toLowerCase() === rawEstado.toLowerCase(),
  );
  const estadoLooksLikeLead =
    /^(pendiente|ilocalizable|cerrado|interesado|cita)/i.test(rawEstado);
  if (catalogEstado) {
    pickIfChanged(out, 'Estado', catalogEstado, getExisting);
  } else if (rawEstado && !estadoLooksLikeLead) {
    pickIfChanged(out, 'Estado', rawEstado, getExisting);
  }

  return out;
}
