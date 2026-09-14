/**
 * Variables del Content Template Twilio `seguimiento_lead_fase3`:
 *   {{1}} = nombre del contacto
 *   {{2}} = propiedad / anuncio
 *
 * Valores dinámicos desde Lead (Sheets → Postgres) y, si faltan,
 * desde variables Retell de la llamada. Sin literales fijos de negocio.
 */

export type LeadLikeForSmsVars = {
  name?: string | null;
  metadata?: unknown;
};

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function pickString(
  ...candidates: Array<unknown>
): string {
  for (const c of candidates) {
    if (c == null) continue;
    const s = String(c).trim();
    if (s) return s;
  }
  return '';
}

function metaGet(
  meta: Record<string, unknown>,
  ...keys: string[]
): string {
  for (const key of keys) {
    const v = pickString(meta[key]);
    if (v) return v;
  }
  return '';
}

/** Nombre para {{1}}. */
export function resolveLeadContactName(
  lead: LeadLikeForSmsVars,
  callVars?: Record<string, unknown> | null,
): string {
  const meta = asRecord(lead.metadata);
  const vars = asRecord(callVars);
  return pickString(
    lead.name,
    metaGet(meta, 'nombre_contacto', 'nombre_contacto_1', 'nombre_interlocutor'),
    vars.nombre_contacto_1,
    vars.nombre_contacto,
    vars.nombre_interlocutor,
    vars.nombre_propietario,
  );
}

/**
 * Etiqueta de propiedad para {{2}}.
 * Preferencia: título de anuncio Sheets → dirección compuesta → tipo+municipio.
 */
export function resolveLeadPropertyLabel(
  lead: LeadLikeForSmsVars,
  callVars?: Record<string, unknown> | null,
): string {
  const meta = asRecord(lead.metadata);
  const vars = asRecord(callVars);

  const explicit = pickString(
    metaGet(meta, 'propiedad', 'direccion_titulo_anuncio', 'Direccion titulo anuncio'),
    vars['Direccion titulo anuncio'],
    vars.direccion_titulo_anuncio,
    vars.propiedad,
  );
  if (explicit) return explicit;

  const tipoVia = pickString(
    metaGet(meta, 'tipo_via'),
    vars.tipo_via,
  );
  const nombreVia = pickString(
    metaGet(meta, 'nombre_via'),
    vars.nombre_via,
  );
  const numeroVia = pickString(
    metaGet(meta, 'numero_via'),
    vars.numero_via,
  );
  const street = [tipoVia, nombreVia, numeroVia].filter(Boolean).join(' ').trim();

  const municipio = pickString(
    metaGet(meta, 'municipio'),
    vars.municipio,
  );
  const pueblo = pickString(
    metaGet(meta, 'pueblo_barrio', 'pueblo'),
    vars.pueblo_barrio,
    vars.pueblo,
  );
  const tipo = pickString(
    metaGet(meta, 'tipo_inmueble'),
    vars.tipo_inmueble,
  );

  if (street && (pueblo || municipio)) {
    return `${street}, ${pueblo || municipio}`;
  }
  if (street) return street;
  if (tipo && (pueblo || municipio)) {
    return `${tipo} en ${pueblo || municipio}`;
  }
  if (pueblo || municipio) return pueblo || municipio;
  if (tipo) return tipo;
  return '';
}

/** Payload Twilio contentVariables: keys "1" y "2" como string. */
export function buildSeguimientoSmsContentVariables(
  lead: LeadLikeForSmsVars,
  callVars?: Record<string, unknown> | null,
): { '1': string; '2': string } {
  return {
    '1': resolveLeadContactName(lead, callVars),
    '2': resolveLeadPropertyLabel(lead, callVars),
  };
}

/**
 * Metadata de propiedad a persistir en el Lead desde una fila de Sheets.
 * `get` = GoogleSpreadsheetRow.get / mapa cabecera→valor.
 */
export function buildLeadPropertyMetadataFromSheet(get: (header: string) => unknown): {
  municipio?: string;
  tipo_inmueble?: string;
  tipo_via?: string;
  nombre_via?: string;
  numero_via?: string;
  pueblo_barrio?: string;
  provincia?: string;
  direccion_titulo_anuncio?: string;
  propiedad?: string;
} {
  const cell = (...headers: string[]) => {
    for (const h of headers) {
      const v = pickString(get(h));
      if (v) return v;
    }
    return undefined;
  };

  const municipio = cell('Municipio');
  const tipo_inmueble = cell('Tipo de inmueble');
  const tipo_via = cell('Tipo Via');
  const nombre_via = cell('Nombre via');
  const numero_via = cell('Numero Via');
  const pueblo_barrio = cell('Pueblo/Barrio/distrito');
  const provincia = cell('Provincia');
  const direccion_titulo_anuncio = cell('Direccion titulo anuncio');

  const partial = {
    municipio,
    tipo_inmueble,
    tipo_via,
    nombre_via,
    numero_via,
    pueblo_barrio,
    provincia,
    direccion_titulo_anuncio,
  };

  const propiedad = resolveLeadPropertyLabel({ metadata: partial });

  return {
    ...partial,
    ...(propiedad ? { propiedad } : {}),
  };
}
