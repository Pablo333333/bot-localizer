/**
 * Mapeo Retell CAD → payload WP Residence (estate_property).
 * Metakeys nativos: https://help.wpresidence.net/article/technical-how-to-default-property-fields/
 */

export type RetellCad = Record<string, unknown>;

export interface EstatePropertyPayload {
  title: string;
  content: string;
  status: string;
  featured_media?: number;
  meta: Record<string, string | number>;
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

export function resolveCategorySlug(tipoInmueble: unknown): string | undefined {
  const t = sanitizeValue(tipoInmueble).toLowerCase();
  if (!t) return undefined;
  if (t.includes('oficina')) return 'oficinas';
  if (t.includes('nave') || t.includes('industrial') || t.includes('almacen') || t.includes('almacén')) {
    return 'naves-industriales';
  }
  if (t.includes('local') || t.includes('comercial') || t.includes('tienda')) {
    return 'locales';
  }
  return 'locales';
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

function buildHtmlContent(
  cad: RetellCad | undefined,
  callSummary: string | undefined,
  callId: string | undefined,
): string {
  return `
      <h3>Detalles del Inmueble</h3>
      <ul>
        <li><strong>Tipo de inmueble:</strong> ${displayValue(cad?.tipo_inmueble)}</li>
        <li><strong>Estado:</strong> ${displayValue(cad?.estado)}</li>
        <li><strong>Superficie Total:</strong> ${formatSurfaceDisplay(cad?.superficie_total)}</li>
        <li><strong>Superficie Útil:</strong> ${formatSurfaceDisplay(cad?.superficie_util)}</li>
        <li><strong>Precio Alquiler:</strong> ${formatCurrencyDisplay(cad?.precio_alquiler)}</li>
        <li><strong>Precio Venta:</strong> ${formatCurrencyDisplay(cad?.precio_venta)}</li>
        <li><strong>Precio Traspaso:</strong> ${formatCurrencyDisplay(cad?.precio_traspaso)}</li>
        <li><strong>¿Fianza?:</strong> ${displayValue(cad?.fianza_meses || cad?.fianza, 'A consultar')}</li>
        <li><strong>¿Gastos de comunidad?:</strong> ${formatCurrencyDisplay(cad?.gastos_comunidad)}</li>
        <li><strong>Disponibilidad:</strong> ${displayValue(cad?.disponibilidad)}</li>
      </ul>

      <h3>Características Técnicas</h3>
      <ul>
        <li><strong>Año de construcción:</strong> ${displayValue(cad?.anio_construccion)}</li>
        <li><strong>Año de reforma:</strong> ${displayValue(cad?.anio_reforma)}</li>
        <li><strong>Número de plantas:</strong> ${displayValue(cad?.num_plantas)}</li>
        <li><strong>Número de aseos/baños:</strong> ${displayValue(cad?.numero_aseos || cad?.aseos || cad?.numero_banios)}</li>
        <li><strong>Aforo máximo:</strong> ${displayValue(cad?.aforo_maximo)}</li>
        <li><strong>Vado:</strong> ${displayValue(cad?.vado)}</li>
        <li><strong>Altura techos:</strong> ${displayValue(cad?.altura_techos, 'No especificada')}</li>
        <li><strong>Iluminación:</strong> ${displayValue(cad?.iluminacion, 'No especificada')}</li>
        <li><strong>Suelos:</strong> ${displayValue(cad?.suelos)}</li>
        <li><strong>Certificación energética:</strong> ${displayValue(cad?.certificado_energetico || cad?.certificacion, 'No especificada')}</li>
      </ul>

      <h3>Distribución y Equipamiento</h3>
      <ul>
        <li><strong>Posición exacta:</strong> ${displayValue(cad?.posicion_exacta)}</li>
        <li><strong>Escaparates/Ventanales:</strong> ${displayValue(cad?.escaparates)}</li>
        <li><strong>Disposición (Diafano?):</strong> ${displayValue(cad?.disposicion_diafano || cad?.['disposicion_diafano?'])}</li>
        <li><strong>Almacen/trastienda:</strong> ${formatSurfaceDisplay(cad?.almacen_trastienda)}</li>
        <li><strong>Terraza propia:</strong> ${formatSurfaceDisplay(cad?.terraza_patio)}</li>
        <li><strong>Equipamiento:</strong> ${displayValue(cad?.equipamiento)}</li>
        <li><strong>Eventos permitidos:</strong> ${displayValue(cad?.eventos)}</li>
        <li><strong>Limpieza:</strong> ${displayValue(cad?.limpieza)}</li>
      </ul>

      <h3>Ubicación</h3>
      <ul>
        <li><strong>Dirección:</strong> ${displayValue(cad?.tipo_via, '')} ${displayValue(cad?.nombre_via, '')} ${displayValue(cad?.numero_via || cad?.altura, '')}</li>
        <li><strong>Pueblo/Barrio:</strong> ${displayValue(cad?.pueblo_barrio || cad?.pueblo, '')}</li>
        <li><strong>Municipio:</strong> ${displayValue(cad?.municipio, '')}</li>
        <li><strong>Provincia:</strong> ${displayValue(cad?.provincia, '')}</li>
      </ul>

      <h3>Información Adicional</h3>
      <p><strong>Negocio anterior:</strong> ${displayValue(cad?.negocio_anterior)}</p>
      <p><strong>¿Negociable?:</strong> ${displayValue(cad?.es_negociable)}</p>
      <p><strong>Descripción:</strong> ${callSummary || sanitizeValue(cad?.informacion_adicional) || 'Sin descripción adicional.'}</p>
      
      <hr>
      <p><em>Publicado automáticamente por Localisto IA. Referencia de llamada: ${callId || ''}</em></p>
    `;
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
  const floors = toNumericMeta(cad?.num_plantas);
  const energy = sanitizeValue(
    cad?.certificado_energetico || cad?.certificacion,
  );
  const yearBuilt = sanitizeValue(cad?.anio_construccion);
  const imageUrl = extractImageUrlFromCad(cad);

  const meta: Record<string, string | number> = {};

  if (price) {
    meta.property_price = price;
    if (operation === 'alquiler') {
      meta.property_label = '/mes';
    } else if (operation === 'traspaso') {
      meta.property_label = 'traspaso';
    }
  }

  // WP Residence: property_size = superficie útil/habitable; lot = parcela/total
  if (sizeUtil) meta.property_size = sizeUtil;
  else if (sizeTotal) meta.property_size = sizeTotal;
  if (sizeTotal && sizeUtil) meta.property_lot_size = sizeTotal;

  if (baths) meta.property_bathrooms = baths;
  if (floors) meta.property_rooms = floors;

  const area = sanitizeValue(cad?.pueblo_barrio || cad?.pueblo);
  const city = sanitizeValue(cad?.municipio);
  const state = sanitizeValue(cad?.provincia);
  // property_city / property_area son taxonomías en WP Residence; la dirección va en meta.
  const addressFull = [address, area, city].filter(Boolean).join(', ');
  if (addressFull) meta.property_address = addressFull;
  if (state) meta.property_state = state;
  meta.property_country = 'Spain';

  const statusProp = sanitizeValue(cad?.estado) || sanitizeValue(cad?.disponibilidad);
  if (statusProp) meta.property_status = statusProp;

  const notesParts = [
    sanitizeValue(callData.call_analysis?.call_summary),
    sanitizeValue(cad?.informacion_adicional),
    sanitizeValue(cad?.negocio_anterior)
      ? `Negocio anterior: ${sanitizeValue(cad?.negocio_anterior)}`
      : '',
    energy ? `Cert. energética: ${energy}` : '',
    yearBuilt ? `Año construcción: ${yearBuilt}` : '',
    callData.call_id ? `Call ID: ${callData.call_id}` : '',
  ].filter(Boolean);
  if (notesParts.length) {
    meta.owner_notes = notesParts.join(' | ');
  }

  // Extras útiles (custom / visibles en admin WP Residence)
  const fianza = sanitizeValue(cad?.fianza_meses || cad?.fianza);
  if (fianza) meta.property_rent_price_extra = `Fianza: ${fianza}`;
  if (energy) meta.energy_class = energy;
  if (yearBuilt) meta.property_year = yearBuilt;

  const payload: EstatePropertyPayload = {
    title: buildTitle(cad, operation),
    content: buildHtmlContent(
      cad,
      callData.call_analysis?.call_summary,
      callData.call_id,
    ),
    status: options.status || 'draft',
    meta,
    _mapping: {
      operation,
      categorySlug: resolveCategorySlug(cad?.tipo_inmueble),
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
  const { _mapping, ...rest } = payload;
  void _mapping;
  return {
    ...rest,
    // Asegura que meta viaje como objeto plano
    meta: { ...payload.meta },
  };
}
