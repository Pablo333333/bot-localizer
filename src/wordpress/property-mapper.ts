/**
 * Mapeo Retell CAD → payload WP Residence (estate_property).
 * Metakeys nativos: https://help.wpresidence.net/article/technical-how-to-default-property-fields/
 */

import {
  buildFallbackCommercialDescription,
  looksLikeTechnicalDump,
} from './commercial-description';
import {
  WPRESTENCE_AGENT_ID,
  WPRESTENCE_AUTHOR_ID,
} from './wpresidence.constants';
import {
  buildWpResidenceTaxonomies,
  type WpResidenceTaxonomies,
} from './wpresidence-taxonomies';

export { resolveCategorySlug } from './wpresidence-taxonomies';

export type RetellCad = Record<string, unknown>;

export interface EstatePropertyPayload {
  title: string;
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

const IMAGE_URL_KEYS = [
  'url_imagen',
  'imagen_url',
  'imagen_drive',
  'google_drive_url',
  'drive_url',
  'foto_url',
  'url_foto',
  'image_url',
] as const;

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

/** Extrae número limpio para meta WP Residence (property_price, property_size, …). */
export function toNumericMeta(v: unknown): string {
  return sanitizeValue(v, true);
}

export function extractImageUrlFromCad(cad: RetellCad | undefined): string | undefined {
  if (!cad) return undefined;
  for (const key of IMAGE_URL_KEYS) {
    const raw = sanitizeValue(cad[key]);
    if (raw && /^https?:\/\//i.test(raw)) {
      return raw;
    }
  }
  return undefined;
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

function buildAddress(cad: RetellCad | undefined): string {
  const parts = [
    sanitizeValue(cad?.tipo_via),
    sanitizeValue(cad?.nombre_via),
    sanitizeValue(cad?.numero_via || cad?.altura),
  ].filter(Boolean);
  return parts.join(' ').trim();
}

function buildTitle(cad: RetellCad | undefined, operation: string): string {
  const tipo = displayValue(cad?.tipo_inmueble, 'Local');
  const via = sanitizeValue(cad?.nombre_via);
  const pueblo = sanitizeValue(cad?.pueblo_barrio || cad?.pueblo);
  const municipio = sanitizeValue(cad?.municipio);
  const ubicacion = [via, pueblo || municipio].filter(Boolean).join(', ');
  const opTag = `[${operation.toUpperCase()}]`;

  if (!ubicacion && tipo === 'Local') {
    return `${opTag} Inmueble Comercial en Localicer.com`;
  }
  return `${opTag} ${tipo}${ubicacion ? ' en ' + ubicacion : ''}`;
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

  const traspaso =
    sanitizeValue(cad?.contrato) ||
    (toNumericMeta(cad?.precio_traspaso) ? 'Traspaso' : '');
  if (traspaso) out['traspaso'] = traspaso;

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
    commercialContent?: string;
    authorId?: number;
    agentId?: number;
  } = {},
): EstatePropertyPayload {
  const cad = callData.call_analysis?.custom_analysis_data;
  const operation = resolveOperation(cad);
  const price = resolvePrimaryPrice(cad, operation);
  const address = buildAddress(cad);
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
  const imageUrl = extractImageUrlFromCad(cad);
  const taxonomies = buildWpResidenceTaxonomies(cad);
  const agentId = options.agentId ?? WPRESTENCE_AGENT_ID;
  const authorId = options.authorId ?? WPRESTENCE_AUTHOR_ID;

  const meta: Record<string, string | number> = {};

  if (price) {
    meta.property_price = price;
    if (operation === 'alquiler') {
      meta.property_label = '/mes';
    } else if (operation === 'traspaso') {
      meta.property_label = 'traspaso';
      meta.property_label_before = 'TRASPASO';
    } else if (operation === 'venta') {
      meta.property_label_before = 'VENTA';
    }
  }

  const alquiler = toNumericMeta(cad?.precio_alquiler);
  const venta = toNumericMeta(cad?.precio_venta);
  const traspaso = toNumericMeta(cad?.precio_traspaso);
  if (operation === 'alquiler' && (venta || traspaso)) {
    meta.property_second_price = venta || traspaso;
    meta.property_second_price_label = venta ? 'venta' : 'traspaso';
  } else if (operation !== 'alquiler' && alquiler) {
    meta.property_second_price = alquiler;
    meta.property_second_price_label = '/mes';
  }

  // WP Residence: property_size = superficie útil/habitable; lot = parcela/total
  if (sizeUtil) meta.property_size = sizeUtil;
  else if (sizeTotal) meta.property_size = sizeTotal;
  if (sizeTotal && sizeUtil) meta.property_lot_size = sizeTotal;
  else if (sizeTotal && !sizeUtil) meta.property_lot_size = sizeTotal;

  if (baths) meta.property_bathrooms = baths;
  if (floors) meta.property_rooms = floors;

  const area = sanitizeValue(cad?.pueblo_barrio || cad?.pueblo);
  const city = sanitizeValue(cad?.municipio);
  const state = sanitizeValue(cad?.provincia);
  const addressFull = [address, area, city].filter(Boolean).join(', ');
  if (addressFull) meta.property_address = addressFull;
  if (state) meta.property_state = state;
  meta.property_country = 'Spain';

  const statusProp = sanitizeValue(cad?.estado) || sanitizeValue(cad?.disponibilidad);
  if (statusProp) meta.property_status = statusProp;

  const notesParts = [
    sanitizeValue(callData.call_analysis?.call_summary),
    sanitizeValue(cad?.informacion_adicional),
    callData.call_id ? `Call ID: ${callData.call_id}` : '',
  ].filter(Boolean);
  if (notesParts.length) {
    meta.owner_notes = notesParts.join(' | ');
  }

  const fianza = sanitizeValue(cad?.fianza_meses || cad?.fianza);
  if (fianza) meta.property_rent_price_extra = `Fianza: ${fianza}`;
  if (energy) meta.energy_class = energy;
  if (yearBuilt) meta.property_year = yearBuilt;

  meta.property_agent = String(agentId);
  meta.property_user = String(authorId);

  Object.assign(meta, buildWpResidenceCustomFields(cad));

  const payload: EstatePropertyPayload = {
    title: buildTitle(cad, operation),
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
      operation,
      categorySlug: taxonomies.property_category[0],
      imageUrl,
    },
  };

  if (options.featuredMediaId) {
    payload.featured_media = options.featuredMediaId;
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
    author: payload.author,
    meta: { ...payload.meta },
    localicer_taxonomies: taxonomies,
  };
}
