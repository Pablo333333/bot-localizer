/** Cabeceras de Localizados usadas como variables Retell. */
export const COL_TIPO_INMUEBLE = 'Tipo de inmueble';
export const COL_DISPONIBILIDAD = 'Disponibilidad del local';
export const COL_DISPONIBILIDAD_ALT = 'Disponibilidad';
export const COL_MUNICIPIO = 'Municipio';

type SheetRowLike = { get: (header: string) => unknown };

/**
 * Claves EXACTAS de {{variable}} en el System Prompt del agente outbound Retell
 * (RETELL_OUTBOUND_AGENT_ID → llm_67368465cc791f69278524169c23).
 */
export const RETELL_OUTBOUND_VARIABLE_KEYS = [
  'tipo_inmueble',
  'disponibilidad',
  'traspaso',
  'pueblo_barrio',
  'municipio',
  'provincia',
  'marca_temporal',
  'negocio_anterior',
  'precio_alquiler',
  'precio_traspaso',
  'precio_venta',
  'superficie_total',
  'info_adicional',
  'Direccion titulo anuncio',
  'Descripción por el propietario',
  'informacion_adicional',
  'Descripcion por el propietario',
  'nombre_interlocutor',
  'superficie_util',
  'tipo_via',
  'nombre_via',
  'numero_via',
  'es_negociable',
  'gastos_comunidad',
  'fianza_meses',
  'estado',
  'numero_banios',
  'email_propietario_gestor',
  'contacto_1_por',
  'contacto_2_por',
  'contacto_3_por',
  'equipamiento',
  'terraza_patio',
  'almacen_trastienda',
  'numero_plantas',
  'altura_techos',
  'Numero de entradas y accesos',
  'vado',
  'disposicion_diafano?',
  'eventos',
  'Vista interior StreetView',
  'certificado_energetico',
  'publicacion_autorizada?',
  'ilocalizable',
  'contrato',
  'target_contact',
  'telefono_contacto_1',
  'nombre_contacto_1',
  'nombre_contacto_2',
  'nombre_contacto_3',
  'email',
] as const;

export type RetellOutboundVariableKey =
  (typeof RETELL_OUTBOUND_VARIABLE_KEYS)[number];

/**
 * Mapeo Retell → columnas del Sheet Localizados (sin defaults hardcoded).
 * Varias columnas = se usa la primera con valor no vacío.
 */
export const RETELL_VARIABLE_SHEET_COLUMNS: Record<
  RetellOutboundVariableKey,
  readonly string[]
> = {
  tipo_inmueble: [COL_TIPO_INMUEBLE],
  disponibilidad: [COL_DISPONIBILIDAD, COL_DISPONIBILIDAD_ALT],
  traspaso: ['Contrato'],
  pueblo_barrio: ['Pueblo/Barrio/distrito'],
  municipio: [COL_MUNICIPIO],
  provincia: ['Provincia'],
  marca_temporal: ['Marca temporal'],
  negocio_anterior: ['Negocio anterior'],
  precio_alquiler: ['Precio ALQUILER/mes'],
  precio_traspaso: ['Precio TRASPASO'],
  precio_venta: ['Precio VENTA'],
  superficie_total: ['Superficie Total'],
  info_adicional: ['Información adicional'],
  'Direccion titulo anuncio': ['Direccion titulo anuncio'],
  'Descripción por el propietario': [
    'Descripción por el propietario',
    'Descripcion por el propietario',
  ],
  informacion_adicional: ['Información adicional'],
  'Descripcion por el propietario': [
    'Descripcion por el propietario',
    'Descripción por el propietario',
  ],
  nombre_interlocutor: [],
  superficie_util: ['Superficie util'],
  tipo_via: ['Tipo Via'],
  nombre_via: ['Nombre via'],
  numero_via: ['Numero Via'],
  es_negociable: ['Negociable'],
  gastos_comunidad: ['Gastos de comunidad'],
  fianza_meses: ['Fianza'],
  estado: ['Estado'],
  numero_banios: ['Numero aseos/baños'],
  email_propietario_gestor: ['Email propietario-gestor'],
  contacto_1_por: ['Contacto1 por'],
  contacto_2_por: ['Contacto2 por'],
  contacto_3_por: ['Contacto3 por'],
  equipamiento: ['Equipamiento'],
  terraza_patio: ['Terraza propia (Superficie m2)'],
  almacen_trastienda: ['Almacen/trastienda (m2)'],
  numero_plantas: ['Numero plantas'],
  altura_techos: ['Altura techos'],
  'Numero de entradas y accesos': ['Numero de entradas y accesos'],
  vado: ['Vado (SI/NO)'],
  'disposicion_diafano?': ['Diafano?'],
  eventos: ['Eventos'],
  'Vista interior StreetView': ['Vista interior StreetView'],
  certificado_energetico: ['Certificación energética'],
  'publicacion_autorizada?': [
    'Publicacion Autorizada?',
    'Publicación Autorizada?',
  ],
  ilocalizable: ['Ilocalizable'],
  contrato: ['Contrato'],
  target_contact: [],
  telefono_contacto_1: ['Telefono1'],
  nombre_contacto_1: ['Nombre contacto1'],
  nombre_contacto_2: ['Nombre contacto2'],
  nombre_contacto_3: ['Nombre contacto3'],
  email: ['Email Avisos', 'Email propietario-gestor'],
};

export type RetellOutboundContext = {
  /** Teléfono E.164 de la llamada (para resolver interlocutor). */
  phoneE164?: string;
  contactIndex?: 1 | 2 | 3;
};

export type RetellDynamicVariablesResult = {
  /** Siempre incluye todas las claves del prompt; vacías como "". */
  variables: Record<RetellOutboundVariableKey, string>;
  /** Claves cuyo valor final es "" (ausente en Sheet o sin dato). */
  missing: RetellOutboundVariableKey[];
};

function readSheetCell(row: SheetRowLike, columns: readonly string[]): string {
  for (const column of columns) {
    const raw = row.get(column);
    if (raw === undefined || raw === null) continue;
    const value = String(raw).trim();
    if (value !== '') return value;
  }
  return '';
}

function normalizePhoneKey(phone: string): string {
  return phone.replace(/\D/g, '');
}

export function resolveOutboundContactIndex(
  row: SheetRowLike,
  phoneE164?: string,
): 1 | 2 | 3 | undefined {
  if (!phoneE164) return undefined;
  const target = normalizePhoneKey(phoneE164);
  const slots: Array<{ index: 1 | 2 | 3; column: string }> = [
    { index: 1, column: 'Telefono1' },
    { index: 2, column: 'Telefono2' },
    { index: 3, column: 'Telefono3' },
  ];
  for (const { index, column } of slots) {
    const raw = row.get(column);
    if (raw == null) continue;
    if (normalizePhoneKey(String(raw)) === target) return index;
  }
  return undefined;
}

function resolveInterlocutorName(
  row: SheetRowLike,
  contactIndex?: 1 | 2 | 3,
): string {
  if (!contactIndex) return '';
  const column =
    contactIndex === 1
      ? 'Nombre contacto1'
      : contactIndex === 2
        ? 'Nombre contacto2'
        : 'Nombre contacto3';
  return readSheetCell(row, [column]);
}

/**
 * Variables dinámicas para Retell al iniciar la llamada outbound.
 * Todas las claves del System Prompt se envían siempre; valores vacíos como "".
 */
export function buildRetellDynamicVariables(
  row: SheetRowLike,
  context: RetellOutboundContext = {},
): RetellDynamicVariablesResult {
  const contactIndex =
    context.contactIndex ?? resolveOutboundContactIndex(row, context.phoneE164);

  const variables = {} as Record<RetellOutboundVariableKey, string>;
  const missing: RetellOutboundVariableKey[] = [];

  for (const key of RETELL_OUTBOUND_VARIABLE_KEYS) {
    let value = '';

    if (key === 'nombre_interlocutor') {
      value = resolveInterlocutorName(row, contactIndex);
    } else if (key === 'target_contact') {
      value = contactIndex ? `contacto_${contactIndex}` : '';
    } else {
      value = readSheetCell(row, RETELL_VARIABLE_SHEET_COLUMNS[key]);
    }

    variables[key] = value;
    if (value === '') missing.push(key);
  }

  return { variables, missing };
}
