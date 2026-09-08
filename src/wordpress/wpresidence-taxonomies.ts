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

function toNumericMeta(v: unknown): string {
  if (v === undefined || v === null) return '';
  let s = String(v).trim().replace(/[€$m²\s]/g, '');
  if (!s) return '';
  if (s.includes('.') && s.includes(',')) {
    s = s.replace(/\./g, '').replace(',', '.');
  } else if (s.includes(',')) {
    s = s.replace(',', '.');
  }
  return s;
}

export type WpResidenceTaxonomies = {
  property_category: string[];
  property_action_category: string[];
  property_city: string[];
  property_area: string[];
  property_county_state: string[];
  property_features: string[];
  property_status: string[];
};

/** Slugs reales de property_category en localicer.com (modelo 33393 usa `local`). */
const CATEGORY_RULES: ReadonlyArray<{ slug: string; tests: RegExp }> = [
  { slug: 'oficina', tests: /oficina/i },
  { slug: 'nave', tests: /nave|industrial|almacen|almac[eé]n/i },
  { slug: 'edificio', tests: /edificio/i },
  { slug: 'complejo-entero', tests: /complejo/i },
  { slug: 'local', tests: /local|comercial|tienda|negocio/i },
];

const FEATURE_RULES: ReadonlyArray<{ slug: string; tests: RegExp }> = [
  { slug: 'a-pie-de-calle-planta-baja', tests: /pie de calle|planta baja|diafan/i },
  { slug: 'acceso-discapacitados', tests: /discapacit|minusv[aá]lid|pmr|movilidad reducida/i },
  { slug: 'aire-acondicionado', tests: /aire acond|a\/a|climatizaci/i },
  { slug: 'almacen-despacho', tests: /almac[eé]n|trastienda|despacho/i },
  { slug: 'altillo', tests: /altillo/i },
  { slug: 'aparcamiento', tests: /aparcamiento|parking|vado/i },
  { slug: 'ascensor', tests: /ascensor/i },
  { slug: 'aseo-adaptado-minusvalidos', tests: /aseo adaptado/i },
  { slug: 'aseos-separados', tests: /aseos separados/i },
  { slug: 'aseos-unisex', tests: /unisex/i },
  { slug: 'barbacoa', tests: /barbacoa/i },
  { slug: 'barra-mostrador', tests: /barra|mostrador/i },
  { slug: 'barrera-metalica', tests: /barrera met/i },
  { slug: 'bodega', tests: /bodega/i },
  { slug: 'cafetera', tests: /cafetera/i },
  { slug: 'calefaccion', tests: /calefacci/i },
  { slug: 'climatizacion', tests: /bomba de calor|climatizaci/i },
  { slug: 'cocina-equipada', tests: /cocina equipada/i },
  { slug: 'en-centro-comercial', tests: /centro comercial/i },
  { slug: 'entreplanta', tests: /entreplanta/i },
  { slug: 'gas-ciudad-natural', tests: /gas ciudad|gas natural/i },
  { slug: 'grandes-escaparates', tests: /grandes escaparates|escaparate/i },
  { slug: 'hace-esquina', tests: /esquina/i },
  { slug: 'instalacion-telefonica', tests: /tel[eé]fon/i },
  { slug: 'mobiliario', tests: /mobiliario|amuebl/i },
  { slug: 'neveras-camaras', tests: /nevera|c[aá]mara frigor/i },
  { slug: 'persiana-enrollable', tests: /persiana/i },
  { slug: 'portero-automatico', tests: /portero/i },
  { slug: 'salida-de-humos', tests: /salida de humos/i },
  { slug: 'sistema-seguridad-alarma', tests: /alarma|seguridad|videovigilancia/i },
  { slug: 'sotano', tests: /s[oó]tano/i },
  { slug: 'subterraneo', tests: /subterr[aá]neo/i },
  { slug: 'terraza', tests: /terraza|patio/i },
  { slug: 'tv-proyector', tests: /proyector|\btv\b/i },
  { slug: 'vestuarios-ducha', tests: /vestuario|ducha/i },
  { slug: 'wifi', tests: /wifi|wi-fi|fibra/i },
];

export function slugifyWpTerm(value: unknown): string {
  const s = sanitizeValue(value)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return s;
}

function uniqueSlugs(values: Array<string | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    if (!v || seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}

function cadBlob(cad: CadLike | undefined): string {
  if (!cad) return '';
  return [
    cad.equipamiento,
    cad.informacion_adicional,
    cad.info_adicional,
    cad.extras,
    cad.escaparates,
    cad.disposicion_diafano,
    cad['disposicion_diafano?'],
    cad.posicion_exacta,
    cad.eventos,
    cad.vado,
    cad.iluminacion,
    cad.suelos,
    cad.negocio_anterior,
    cad.descripcion_propietario,
  ]
    .map((v) => sanitizeValue(v))
    .filter(Boolean)
    .join(' | ');
}

export function resolveCategorySlug(tipoInmueble: unknown): string {
  const t = sanitizeValue(tipoInmueble);
  if (!t) return 'local';
  for (const { slug, tests } of CATEGORY_RULES) {
    if (tests.test(t)) return slug;
  }
  return 'local';
}

export function resolveActionCategorySlugs(cad: CadLike | undefined): string[] {
  const contrato = sanitizeValue(cad?.contrato).toLowerCase();
  const slugs: string[] = [];
  const hasAlquiler = !!toNumericMeta(cad?.precio_alquiler);
  const hasVenta = !!toNumericMeta(cad?.precio_venta);
  const hasTraspaso = !!toNumericMeta(cad?.precio_traspaso);

  if (contrato.includes('traspaso') || hasTraspaso) slugs.push('traspaso');
  if (contrato.includes('venta') || contrato.includes('compra') || hasVenta) {
    slugs.push('venta');
  }
  if (contrato.includes('alquiler') || contrato.includes('renta') || hasAlquiler) {
    slugs.push('alquiler');
  }

  if (slugs.length === 0) slugs.push('alquiler');
  return uniqueSlugs(slugs);
}

export function resolveFeatureSlugs(cad: CadLike | undefined): string[] {
  const blob = cadBlob(cad);
  const slugs: string[] = [];

  for (const { slug, tests } of FEATURE_RULES) {
    if (tests.test(blob)) slugs.push(slug);
  }

  const terraza = toNumericMeta(cad?.terraza_patio);
  if (terraza && Number(terraza) > 0) slugs.push('terraza');

  const almacen = toNumericMeta(cad?.almacen_trastienda);
  if (almacen && Number(almacen) > 0) slugs.push('almacen-despacho');

  const vado = sanitizeValue(cad?.vado).toLowerCase();
  if (['si', 'sí', 'yes', 'true', '1'].includes(vado)) slugs.push('aparcamiento');

  const escaparates = toNumericMeta(cad?.escaparates);
  if (escaparates && Number(escaparates) >= 2) slugs.push('grandes-escaparates');

  const disposicion = sanitizeValue(
    cad?.disposicion_diafano || cad?.['disposicion_diafano?'] || cad?.posicion_exacta,
  ).toLowerCase();
  if (disposicion.includes('pie de calle') || disposicion.includes('planta baja')) {
    slugs.push('a-pie-de-calle-planta-baja');
  }

  return uniqueSlugs(slugs);
}

export function resolveStatusSlugs(cad: CadLike | undefined): string[] {
  const slugs: string[] = [];
  const estado = sanitizeValue(cad?.estado).toLowerCase();
  const disponibilidad = sanitizeValue(cad?.disponibilidad).toLowerCase();
  const negociable = sanitizeValue(cad?.es_negociable).toLowerCase();
  const eventos = sanitizeValue(cad?.eventos).toLowerCase();
  const negocio = sanitizeValue(cad?.negocio_anterior).toLowerCase();

  if (estado.includes('reformado')) slugs.push('reformado');
  else if (estado.includes('nuevo') || estado.includes('obra nueva')) slugs.push('nuevo');
  else if (estado.includes('bruto')) slugs.push('en-bruto');
  else if (estado.includes('reformar') || estado.includes('segunda mano')) {
    slugs.push('por-reformar');
  } else if (estado.includes('buen')) slugs.push('buen-estado');

  if (
    ['disponible', 'si', 'sí', 'yes', 'true'].includes(disponibilidad) ||
    disponibilidad.includes('inmediata')
  ) {
    slugs.push('disponible-inmediatamente');
  } else if (disponibilidad.includes('proxim')) {
    slugs.push('disponible-proximamente');
  }

  if (['si', 'sí', 'yes', 'true', '1'].includes(negociable)) {
    slugs.push('precio-negociable');
  }

  if (['si', 'sí', 'yes', 'true', '1'].includes(eventos) || eventos.includes('permit')) {
    slugs.push('apto-para-eventos');
  }

  if (negocio && negocio !== 'no' && !negocio.includes('cerrad')) {
    slugs.push('actividad-funcionando');
  }

  return uniqueSlugs(slugs);
}

export function buildWpResidenceTaxonomies(
  cad: CadLike | undefined,
): WpResidenceTaxonomies {
  const city = slugifyWpTerm(cad?.municipio);
  const area = slugifyWpTerm(cad?.pueblo_barrio || cad?.pueblo);
  const county = slugifyWpTerm(cad?.provincia);

  return {
    property_category: [resolveCategorySlug(cad?.tipo_inmueble)],
    property_action_category: resolveActionCategorySlugs(cad),
    property_city: city ? [city] : [],
    property_area: area ? [area] : [],
    property_county_state: county ? [county] : [],
    property_features: resolveFeatureSlugs(cad),
    property_status: resolveStatusSlugs(cad),
  };
}
