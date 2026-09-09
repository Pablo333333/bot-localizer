import { RetellCad, sanitizeValue } from './property-mapper';

type SheetRowLike = { get: (header: string) => unknown };

/** Sheet Localizados → claves CAD usadas por buildEstatePropertyPayload. */
const SHEET_TO_CAD: ReadonlyArray<{
  cadKey: keyof RetellCad | string;
  columns: readonly string[];
  cleanSymbols?: boolean;
}> = [
  { cadKey: 'tipo_inmueble', columns: ['Tipo de inmueble'] },
  {
    cadKey: 'disponibilidad',
    columns: ['Disponibilidad del local', 'Disponibilidad'],
  },
  { cadKey: 'informacion_adicional', columns: ['Información adicional'] },
  {
    cadKey: 'descripcion_propietario',
    columns: [
      'Descripción por el propietario',
      'Descripcion por el propietario',
    ],
  },
  { cadKey: 'superficie_total', columns: ['Superficie Total'], cleanSymbols: true },
  { cadKey: 'superficie_util', columns: ['Superficie util'], cleanSymbols: true },
  { cadKey: 'negocio_anterior', columns: ['Negocio anterior'] },
  { cadKey: 'estado', columns: ['Estado'] },
  { cadKey: 'anio_construccion', columns: ['Año de construcción'] },
  { cadKey: 'anio_reforma', columns: ['Año reforma'] },
  {
    cadKey: 'numero_banios',
    columns: ['Numero aseos/baños'],
    cleanSymbols: true,
  },
  { cadKey: 'posicion_exacta', columns: ['Posición exacta'] },
  { cadKey: 'escaparates', columns: ['Escaparates/ventanales'] },
  {
    cadKey: 'disposicion_diafano',
    columns: ['Diafano?', 'Disposición'],
  },
  { cadKey: 'eventos', columns: ['Eventos'] },
  {
    cadKey: 'almacen_trastienda',
    columns: ['Almacen/trastienda (m2)'],
    cleanSymbols: true,
  },
  {
    cadKey: 'terraza_patio',
    columns: ['Terraza propia (Superficie m2)'],
    cleanSymbols: true,
  },
  { cadKey: 'equipamiento', columns: ['Equipamiento'] },
  {
    cadKey: 'certificado_energetico',
    columns: ['Certificación energética'],
  },
  { cadKey: 'aforo_maximo', columns: ['Aforo máximo'], cleanSymbols: true },
  { cadKey: 'limpieza', columns: ['Limpieza'] },
  { cadKey: 'tipo_via', columns: ['Tipo Via'] },
  { cadKey: 'nombre_via', columns: ['Nombre via'] },
  { cadKey: 'numero_via', columns: ['Numero Via'] },
  { cadKey: 'pueblo_barrio', columns: ['Pueblo/Barrio/distrito'] },
  { cadKey: 'municipio', columns: ['Municipio'] },
  { cadKey: 'provincia', columns: ['Provincia'] },
  {
    cadKey: 'latitud',
    columns: ['Latitud', 'Latitude', 'property_latitude', 'Lat'],
  },
  {
    cadKey: 'longitud',
    columns: ['Longitud', 'Longitude', 'property_longitude', 'Lng', 'Lon'],
  },
  {
    cadKey: 'codigo_postal',
    columns: ['Codigo postal', 'Código postal', 'CP', 'Zip', 'property_zip'],
  },
  { cadKey: 'precio_venta', columns: ['Precio VENTA'], cleanSymbols: true },
  { cadKey: 'precio_traspaso', columns: ['Precio TRASPASO'], cleanSymbols: true },
  {
    cadKey: 'precio_alquiler',
    columns: ['Precio ALQUILER/mes'],
    cleanSymbols: true,
  },
  { cadKey: 'fianza_meses', columns: ['Fianza'], cleanSymbols: true },
  {
    cadKey: 'gastos_comunidad',
    columns: ['Gastos de comunidad'],
    cleanSymbols: true,
  },
  { cadKey: 'es_negociable', columns: ['Negociable'] },
  { cadKey: 'vado', columns: ['Vado (SI/NO)'] },
  { cadKey: 'altura_techos', columns: ['Altura techos'] },
  { cadKey: 'num_plantas', columns: ['Numero plantas'] },
  { cadKey: 'contrato', columns: ['Contrato'] },
  { cadKey: 'iluminacion', columns: ['Iluminacion'] },
  { cadKey: 'suelos', columns: ['Suelos'] },
  {
    cadKey: 'url_imagen',
    columns: [
      'URL imagen',
      'Url imagen',
      'url_imagen',
      'Imagen URL',
      'URLs imagenes',
      'URLs imágenes',
      'Imagenes Drive',
      'Imágenes Drive',
    ],
  },
  {
    cadKey: 'carpeta_drive',
    columns: [
      'Carpeta Drive',
      'Drive folder',
      'Drive Folder ID',
      'ID carpeta Drive',
      'carpeta_drive',
      'Google Drive Folder',
    ],
  },
];

export const WP_POST_ID_SHEET_HEADERS = [
  'ID_WP',
  'WP Post ID',
  'Wp Post ID',
  'Referencia',
  'Referencia / WP Post ID',
] as const;

function readSheetCell(
  row: SheetRowLike,
  columns: readonly string[],
  cleanSymbols = false,
): string {
  for (const column of columns) {
    const value = sanitizeValue(row.get(column), cleanSymbols);
    if (value) return value;
  }
  return '';
}

/** Lee el ID de WordPress ya guardado en la fila (idempotencia). */
export function readWpPostIdFromSheetRow(row: SheetRowLike): number | undefined {
  for (const header of WP_POST_ID_SHEET_HEADERS) {
    const raw = row.get(header);
    if (raw === undefined || raw === null) continue;
    const trimmed = String(raw).trim();
    if (/^\d+$/.test(trimmed)) {
      return Number(trimmed);
    }
  }
  return undefined;
}

/** Convierte una fila de Localizados al CAD esperado por property-mapper. */
export function sheetRowToCad(row: SheetRowLike): RetellCad {
  const cad: RetellCad = {};

  for (const { cadKey, columns, cleanSymbols } of SHEET_TO_CAD) {
    const value = readSheetCell(row, columns, cleanSymbols);
    if (value) {
      cad[cadKey] = value;
    }
  }

  return cad;
}

/** Objeto callData compatible con buildEstatePropertyPayload / createPropertyPost. */
export function sheetRowToCallData(row: SheetRowLike): {
  call_id?: string;
  call_analysis: {
    call_summary?: string;
    custom_analysis_data: RetellCad;
  };
} {
  const callId = readSheetCell(row, ['Call ID']);
  const cad = sheetRowToCad(row);
  const summary = readSheetCell(row, ['Información adicional']);

  return {
    call_id: callId || undefined,
    call_analysis: {
      call_summary: summary || undefined,
      custom_analysis_data: cad,
    },
  };
}
