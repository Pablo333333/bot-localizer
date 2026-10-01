/**
 * Mapeo Retell CAD → payload WP Residence (estate_property).
 * Metakeys nativos: https://help.wpresidence.net/article/technical-how-to-default-property-fields/
 */

import {
  buildFallbackCommercialDescription,
  looksLikeTechnicalDump,
} from './commercial-description';
import {
  extractFirstImageUrlFromCad,
  formatPropertyImagesMeta,
} from './property-media-sources';
import {
  WPRESTENCE_AGENT_ID,
  WPRESTENCE_AUTHOR_ID,
} from './wpresidence.constants';
import {
  buildWpResidenceTaxonomies,
  type WpResidenceTaxonomies,
} from './wpresidence-taxonomies';

export { resolveCategorySlug } from './wpresidence-taxonomies';
export {
  extractDriveFolderIdFromCad,
  extractFirstImageUrlFromCad,
  extractImageUrlsFromCad,
  formatPropertyImagesMeta,
} from './property-media-sources';

export type RetellCad = Record<string, unknown>;

export interface EstatePropertyPayload {
  title: string;
  slug: string;
  content: string;
  status: string;
  author: number;
  featured_media?: number;
  meta: Record<string, string | number>;
  taxonomies: WpResidenceTaxonomies;
  /** Campos auxiliares para taxonomías / logs (no siempre enviados a REST). */
  _mapping?: {
    operation: 'alquiler' | 'venta' | 'traspaso';
    categorySlug?: string;
    imageUrl?: string;
  };
}

/** Compat: primera URL de imagen Drive del CAD. */
export function extractImageUrlFromCad(
  cad: RetellCad | undefined,
): string | undefined {
  return extractFirstImageUrlFromCad(cad);
}

export function sanitizeValue(
  v: unknown,
  cleanSymbols = false,
): string {
  if (v === undefined || v === null) return '';
  let s = String(v).trim();
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
  return s;
}

export function displayValue(
  v: unknown,
  fallback = 'No especificado',
  cleanSymbols = false,
): string {
  const s = sanitizeValue(v, cleanSymbols);
  return s !== '' ? s : fallback;
}

export function formatCurrencyDisplay(v: unknown): string {
  const s = sanitizeValue(Array.isArray(v) ? v[0] : v, true);
  if (!s) return 'A consultar';
  const num = parseFloat(s);
  if (isNaN(num)) return s;
  return new Intl.NumberFormat('es-ES').format(num) + ' €';
}

export function formatSurfaceDisplay(v: unknown): string {
  const s = sanitizeValue(v, true);
  if (!s) return 'No especificada';
  return s + ' m²';
}

/** Extrae número limpio para meta WP Residence (property_price, property_size, …). Un 0 no es precio ni superficie. */
export function toNumericMeta(v: unknown): string {
  const s = sanitizeValue(v, true);
  if (!s || !/^\d+(\.\d+)?$/.test(s)) return '';
  if (Number(s) === 0) return '';
  return s;
}

/** Lat/lng: admite "39,572" o "39.572" sin convertir coma de miles. */
export function sanitizeCoordinate(v: unknown): string {
  if (v === undefined || v === null) return '';
  let s = String(v).trim().replace(/\s+/g, '');
  if (!s) return '';
  if (s.includes(',') && !s.includes('.')) {
    s = s.replace(',', '.');
  }
  const n = Number.parseFloat(s);
  if (!Number.isFinite(n)) return '';
  return String(n);
}

export function resolveOperation(
  cad: RetellCad | undefined,
): 'alquiler' | 'venta' | 'traspaso' {
  const contrato = sanitizeValue(cad?.contrato).toLowerCase();
  if (contrato.includes('traspaso')) return 'traspaso';
  if (contrato.includes('venta') || contrato.includes('compra')) return 'venta';
  if (contrato.includes('alquiler') || contrato.includes('renta')) return 'alquiler';

  const hasAlquiler = !!toNumericMeta(cad?.precio_alquiler);
  const hasVenta = !!toNumericMeta(cad?.precio_venta);
  const hasTraspaso = !!toNumericMeta(cad?.precio_traspaso);

  if (hasAlquiler && !hasVenta && !hasTraspaso) return 'alquiler';
  if (hasVenta && !hasAlquiler && !hasTraspaso) return 'venta';
  if (hasTraspaso && !hasAlquiler && !hasVenta) return 'traspaso';
  if (hasAlquiler) return 'alquiler';
  if (hasVenta) return 'venta';
  if (hasTraspaso) return 'traspaso';
  return 'alquiler';
}

export function resolvePrimaryPrice(
  cad: RetellCad | undefined,
  operation: 'alquiler' | 'venta' | 'traspaso',
): string {
  if (operation === 'venta') return toNumericMeta(cad?.precio_venta);
  if (operation === 'traspaso') return toNumericMeta(cad?.precio_traspaso);
  return toNumericMeta(cad?.precio_alquiler);
}

export type ListingOperation = 'venta' | 'traspaso' | 'alquiler';

/** Operaciones presentes en el anuncio, en el orden Venta → Traspaso → Alquiler. */
export function listedOperations(
  cad: RetellCad | undefined,
): ListingOperation[] {
  const contrato = sanitizeValue(cad?.contrato).toLowerCase();
  const ops: ListingOperation[] = [];
  if (
    contrato.includes('venta') ||
    contrato.includes('compra') ||
    !!toNumericMeta(cad?.precio_venta)
  ) {
    ops.push('venta');
  }
  if (contrato.includes('traspaso') || !!toNumericMeta(cad?.precio_traspaso)) {
    ops.push('traspaso');
  }
  if (
    contrato.includes('alquiler') ||
    contrato.includes('renta') ||
    !!toNumericMeta(cad?.precio_alquiler)
  ) {
    ops.push('alquiler');
  }
  return ops;
}

export function resolveListingOperations(
  cad: RetellCad | undefined,
): ListingOperation[] {
  const ops = listedOperations(cad);
  return ops.length > 0 ? ops : [resolveOperation(cad)];
}

/**
 * Precio del buscador (meta property_price).
 * Si el Sheet trae "Precio filtro búsqueda" (columna DH), manda esa cifra.
 * Si no, prioridad Venta → Traspaso → Alquiler.
 */
export function resolveSearchPrice(cad: RetellCad | undefined): {
  amount: string;
  source: 'filtro' | ListingOperation | '';
} {
  const filtro = toNumericMeta(cad?.precio_filtro_busqueda);
  const venta = toNumericMeta(cad?.precio_venta);
  const traspaso = toNumericMeta(cad?.precio_traspaso);
  const alquiler = toNumericMeta(cad?.precio_alquiler);
  if (filtro) return { amount: filtro, source: 'filtro' };
  if (venta) return { amount: venta, source: 'venta' };
  if (traspaso) return { amount: traspaso, source: 'traspaso' };
  if (alquiler) return { amount: alquiler, source: 'alquiler' };
  return { amount: '', source: '' };
}

/** Fila publicable: disponibilidad SI, u operación Alquiler/Venta/Traspaso. */
export function isCadPublishable(cad: RetellCad | undefined): boolean {
  const disp = sanitizeValue(cad?.disponibilidad).toUpperCase();
  if (['NO', 'FALSE', 'NO DISPONIBLE', 'OCUPADO'].includes(disp)) return false;
  if (['DISPONIBLE', 'SÍ', 'SI', 'TRUE', 'YES'].includes(disp)) return true;
  return listedOperations(cad).length > 0;
}

function buildStreetLine(cad: RetellCad | undefined): string {
  const via = [sanitizeValue(cad?.tipo_via), sanitizeValue(cad?.nombre_via)]
    .filter(Boolean)
    .join(' ')
    .trim();
  const numero = sanitizeValue(cad?.numero_via || cad?.altura);
  if (!via) return numero;
  if (!numero) return via;
  if (/^s\s*[/.-]?\s*n\.?$/i.test(numero) || numero.toLowerCase() === 'sn') {
    return `${via} s/n`;
  }
  return `${via}, ${numero}`;
}

const GENERIC_ACTIVITY =
  /^(almac[eé]n|sin actividad|no consta|no|n\/a|na|cerrad[oa]|vac[ií]o|ningun[oa]|local|nave|oficina|local comercial|comercial)$/i;

const GENERIC_AREA =
  /^(centro|centro ciudad|centro-ciudad|casco|casco urbano|casco-urbano)$/i;

function propertyTypeLead(cad: RetellCad | undefined): string {
  const tipo = sanitizeValue(cad?.tipo_inmueble).toLowerCase();
  if (tipo.includes('nave')) return 'Nave';
  if (tipo.includes('oficina')) return 'Oficina';
  if (tipo.includes('edificio')) return 'Edificio';
  if (tipo.includes('complejo')) return 'Complejo';
  return 'Local';
}

function titleLead(
  cad: RetellCad | undefined,
  operations: readonly string[],
): string {
  const onlyTraspaso =
    operations.length > 0 && operations.every((op) => op === 'traspaso');
  if (onlyTraspaso) {
    const negocio = sanitizeValue(cad?.negocio_anterior);
    if (negocio && !GENERIC_ACTIVITY.test(negocio)) return negocio;
  }
  return propertyTypeLead(cad);
}

function formatSizeForTitle(v: unknown): string {
  const s = toNumericMeta(v);
  if (!s) return '';
  const n = Number(s);
  if (!Number.isFinite(n) || n <= 0) return '';
  return String(Math.round(n));
}

/**
 * Mismo patrón que los anuncios publicados:
 * "Restaurante en Calle El califa, 31, Nueva Andalucía, Marbella (MÁLAGA) – [TRASPASO] – 126 m2"
 * WordPress deriva el slug al sanitizar este título.
 */
export function buildListingTitle(
  cad: RetellCad | undefined,
  operation?: string | readonly string[],
): string {
  const fromCad = listedOperations(cad);
  const operations: string[] = Array.isArray(operation)
    ? [...operation]
    : typeof operation === 'string' && operation
      ? fromCad.length > 1
        ? fromCad
        : [operation]
      : fromCad.length > 0
        ? fromCad
        : [resolveOperation(cad)];
  const lead = titleLead(cad, operations);
  const street = buildStreetLine(cad);
  const municipio = sanitizeValue(cad?.municipio);
  const barrio = sanitizeValue(cad?.pueblo_barrio || cad?.pueblo);
  const provincia = sanitizeValue(cad?.provincia);
  const parts: string[] = [];
  if (street) parts.push(street);
  if (
    barrio &&
    barrio.toLowerCase() !== municipio.toLowerCase() &&
    !GENERIC_AREA.test(barrio)
  ) {
    parts.push(barrio);
  }
  if (municipio) parts.push(municipio);
  const place = parts.join(', ');
  const prov = provincia
    ? ` (${provincia.toLocaleUpperCase('es-ES')})`
    : '';
  const op = operations.map((item) => item.toUpperCase()).join(', ');
  const size =
    formatSizeForTitle(cad?.superficie_total) ||
    formatSizeForTitle(cad?.superficie_util);
  const sizeBit = size ? ` – ${size} m2` : '';
  if (!place) {
    return `${lead} – [${op}]${sizeBit}`.trim();
  }
  return `${lead} en ${place}${prov} – [${op}]${sizeBit}`;
}

/** Slug WP (sanitize_title) a partir del título del anuncio. */
export function buildWpSlug(title: string): string {
  return title
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/m²/g, 'm2')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * WP Residence muestra Afganistán si el país no coincide con el desplegable.
 * La ficha publicada usa "España", no "Spain".
 */
export function normalizeWpCountry(raw: unknown): string {
  const s = sanitizeValue(raw);
  if (!s) return '';
  const key = s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  if (key === 'spain' || key === 'espana' || key === 'es' || key === 'esp') {
    return 'España';
  }
  return s;
}

/**
 * Custom fields oficiales de WPResidence (modelo 33393 — Características básicas).
 * Los slugs coinciden con sanitize_title de las etiquetas del tema.
 */
export function buildWpResidenceCustomFields(
  cad: RetellCad | undefined,
): Record<string, string> {
  const out: Record<string, string> = {};
  const estado = sanitizeValue(cad?.estado);
  if (estado) out['estado-del-inmueble'] = estado;

  const plantas = toNumericMeta(cad?.num_plantas || cad?.numero_plantas);
  if (plantas) out['plantas-del-inmueble'] = plantas;

  const escaparates =
    toNumericMeta(cad?.escaparates) || sanitizeValue(cad?.escaparates);
  if (escaparates) out['numero-de-escaparates'] = escaparates;

  const actividad = sanitizeValue(cad?.negocio_anterior);
  if (actividad) out['ultima-actividad'] = actividad;

  const disposicion = sanitizeValue(
    cad?.disposicion_diafano ||
      cad?.['disposicion_diafano?'] ||
      cad?.posicion_exacta,
  );
  if (disposicion) out['disposicion'] = disposicion;

  const modalidad = sanitizeValue(cad?.modalidad_traspaso);
  if (modalidad) {
    out['traspaso'] = modalidad;
  } else if (
    listedOperations(cad).includes('traspaso') &&
    !listedOperations(cad).includes('venta') &&
    !listedOperations(cad).includes('alquiler')
  ) {
    out['traspaso'] = 'Traspaso';
  }

  const fianza = sanitizeValue(cad?.fianza_meses || cad?.fianza);
  if (fianza) out['fianza'] = fianza;

  const comunidad = toNumericMeta(cad?.gastos_comunidad);
  if (comunidad) out['gastos-de-comunidad'] = comunidad;

  return out;
}

function buildCommercialContent(
  cad: RetellCad | undefined,
  callSummary: string | undefined,
  commercialContent?: string,
): string {
  const explicit = sanitizeValue(commercialContent);
  if (explicit && !looksLikeTechnicalDump(explicit)) return explicit;

  const fromCad = sanitizeValue(
    cad?.descripcion_propietario || cad?.descripcion_por_el_propietario,
  );
  if (fromCad && !looksLikeTechnicalDump(fromCad)) return fromCad;

  return buildFallbackCommercialDescription(cad, callSummary);
}

/**
 * Construye el body para POST /wp/v2/estate_property.
 */
export function buildEstatePropertyPayload(
  callData: {
    call_id?: string;
    call_analysis?: {
      call_summary?: string;
      custom_analysis_data?: RetellCad;
    };
  },
  options: {
    status?: string;
    featuredMediaId?: number;
    /** IDs de adjuntos WP para la galería WPResidence (meta.property_images). */
    galleryMediaIds?: number[];
    commercialContent?: string;
    authorId?: number;
    agentId?: number;
  } = {},
): EstatePropertyPayload {
  const cad = callData.call_analysis?.custom_analysis_data;
  const operations = resolveListingOperations(cad);
  const search = resolveSearchPrice(cad);
  const price = search.amount;
  const baths = toNumericMeta(
    cad?.numero_aseos || cad?.aseos || cad?.numero_banios,
  );
  const sizeUtil = toNumericMeta(cad?.superficie_util);
  const sizeTotal = toNumericMeta(cad?.superficie_total);
  const floors = toNumericMeta(cad?.num_plantas || cad?.numero_plantas);
  const energy = sanitizeValue(
    cad?.certificado_energetico || cad?.certificacion,
  );
  const yearBuilt = sanitizeValue(cad?.anio_construccion);
  const imageUrl = extractFirstImageUrlFromCad(cad);
  const taxonomies = buildWpResidenceTaxonomies(cad);
  const agentId = options.agentId ?? WPRESTENCE_AGENT_ID;
  const authorId = options.authorId ?? WPRESTENCE_AUTHOR_ID;

  const meta: Record<string, string | number> = {};

  const alquiler = toNumericMeta(cad?.precio_alquiler);
  const venta = toNumericMeta(cad?.precio_venta);
  const traspasoPrice = toNumericMeta(cad?.precio_traspaso);
  const onlyRent = !venta && !traspasoPrice && !!alquiler;
  const priceIsRent =
    search.source === 'alquiler' || (search.source === 'filtro' && onlyRent);
  const onlyTraspaso =
    operations.length === 1 && operations[0] === 'traspaso';

  if (price) {
    meta.property_price = price;
    if (priceIsRent) meta.property_label = '/mes';
    else if (onlyTraspaso) meta.property_label = 'traspaso';
  }

  const beforeLabel = sanitizeValue(cad?.etiqueta_precio_antes);
  if (beforeLabel) {
    meta.property_label_before = beforeLabel;
  } else if ((venta || traspasoPrice) && alquiler) {
    const amount = new Intl.NumberFormat('es-ES').format(Number(alquiler));
    meta.property_label_before = `Alquiler ${amount} €/mes`;
  } else if (onlyTraspaso) {
    meta.property_label_before = 'TRASPASO';
  } else if (operations.includes('venta') && !alquiler) {
    meta.property_label_before = 'VENTA';
  }

  // WP Residence: property_size = superficie útil/habitable; lot = parcela/total
  if (sizeUtil) meta.property_size = sizeUtil;
  else if (sizeTotal) meta.property_size = sizeTotal;
  if (sizeTotal && sizeUtil) meta.property_lot_size = sizeTotal;
  else if (sizeTotal && !sizeUtil) meta.property_lot_size = sizeTotal;

  if (baths) meta.property_bathrooms = baths;
  if (floors) meta.property_rooms = floors;

  const state = sanitizeValue(cad?.provincia);
  const sheetAddress = sanitizeValue(cad?.direccion);
  if (sheetAddress) meta.property_address = sheetAddress;
  if (state) meta.property_state = state;
  const country = normalizeWpCountry(cad?.pais ?? cad?.country);
  if (country) meta.property_country = country;

  const zip = sanitizeValue(cad?.codigo_postal || cad?.cp || cad?.zip);
  if (zip) meta.property_zip = zip;

  const lat = sanitizeCoordinate(cad?.latitud || cad?.latitude || cad?.property_latitude);
  const lng = sanitizeCoordinate(
    cad?.longitud || cad?.longitude || cad?.property_longitude,
  );
  if (lat) meta.property_latitude = lat;
  if (lng) meta.property_longitude = lng;
  if (lat && lng) {
    meta.property_google_view = '1';
    meta.page_custom_zoom = '16';
  }

  const statusProp = sanitizeValue(cad?.estado) || sanitizeValue(cad?.disponibilidad);
  if (statusProp) meta.property_status = statusProp;

  const notesParts = [
    sanitizeValue(callData.call_analysis?.call_summary),
    sanitizeValue(cad?.informacion_adicional),
    sanitizeValue(cad?.notas_anunciante),
    callData.call_id ? `Call ID: ${callData.call_id}` : '',
  ].filter(Boolean);
  if (notesParts.length) {
    meta.owner_notes = notesParts.join(' | ');
  }

  const fianza = sanitizeValue(cad?.fianza_meses || cad?.fianza);
  if (fianza) meta.property_rent_price_extra = `Fianza: ${fianza}`;
  if (energy) meta.energy_class = energy;
  if (yearBuilt) meta.property_year = yearBuilt;

  // WPResidence: agent_display_option=agent_agency fuerza el CPT estate_agent (no el autor).
  meta.property_agent = String(agentId);
  meta.property_user = String(authorId);
  meta.agent_display_option = 'agent_agency';

  Object.assign(meta, buildWpResidenceCustomFields(cad));

  const title = buildListingTitle(cad, operations);
  const payload: EstatePropertyPayload = {
    title,
    slug: buildWpSlug(title),
    content: buildCommercialContent(
      cad,
      callData.call_analysis?.call_summary,
      options.commercialContent,
    ),
    status: options.status || 'draft',
    author: authorId,
    meta,
    taxonomies,
    _mapping: {
      operation: operations[0],
      categorySlug: taxonomies.property_category[0],
      imageUrl,
    },
  };

  if (options.featuredMediaId) {
    payload.featured_media = options.featuredMediaId;
  }

  const galleryIds =
    options.galleryMediaIds && options.galleryMediaIds.length > 0
      ? options.galleryMediaIds
      : options.featuredMediaId
        ? [options.featuredMediaId]
        : [];
  const galleryMeta = formatPropertyImagesMeta(galleryIds);
  if (galleryMeta) {
    payload.meta.property_images = galleryMeta;
  }

  return payload;
}

/** Body listo para axios (sin campos internos `_mapping`). */
export function toWordpressRequestBody(
  payload: EstatePropertyPayload,
): Record<string, unknown> {
  const { _mapping, taxonomies, ...rest } = payload;
  void _mapping;
  return {
    ...rest,
    slug: payload.slug,
    author: payload.author,
    meta: { ...payload.meta },
    localicer_taxonomies: taxonomies,
  };
}
