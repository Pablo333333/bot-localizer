import { RetellCad, sanitizeValue } from './property-mapper';
import {
  extractDriveFileId,
  extractDriveFolderId,
} from './property-media-sources';
import {
  SHEET_COL_DIRECCION,
  SHEET_COL_PAIS,
  SHEET_COL_URL_IMAGEN,
} from '../sheets/sheet-row-isolation';

type SheetRowLike = {
  get: (header: string) => unknown;
  toObject?: () => Record<string, unknown>;
  /** Lectura por letra A1 de ESTA fila (P = URL Imagen, CI = país, CX = dirección). */
  getByColumnLetter?: (letter: string) => unknown;
};

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
    cadKey: 'publicacion_autorizada',
    columns: ['Publicacion Autorizada?', 'Publicación Autorizada?'],
  },
  {
    cadKey: 'url_imagen',
    columns: [
      'URL Imagen',
      'URL imagen',
      'Url imagen',
      'url_imagen',
      'Imagen URL',
      'URLs imagenes',
      'URLs imágenes',
      'Imagenes Drive',
      'Imágenes Drive',
      'Fotos Drive',
      'Foto Drive',
      'Link fotos',
      'Enlace fotos',
      'Link Drive',
      'Enlace Drive',
      'Google Drive',
      'Fotos',
    ],
  },
  {
    cadKey: 'carpeta_drive',
    columns: [
      'Carpeta Drive',
      'Carpeta Google Drive',
      'Drive folder',
      'Drive Folder ID',
      'ID carpeta Drive',
      'carpeta_drive',
      'Google Drive Folder',
      'Carpeta fotos',
      'Folder Drive',
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

function normalizeHeader(raw: string): string {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[_?/]+/g, ' ')
    .replace(/\s+/g, ' ');
}

function isStreetViewOrMapsHeader(normalized: string): boolean {
  return (
    normalized.includes('streetview') ||
    normalized.includes('street view') ||
    normalized.includes('vista interior') ||
    normalized.includes('maps')
  );
}

/** HYPERLINK / objetos de celda → URL o texto usable. */
export function unwrapSheetCellValue(raw: unknown): string {
  if (raw === undefined || raw === null) return '';
  if (typeof raw === 'object') {
    const o = raw as Record<string, unknown>;
    for (const key of ['hyperlink', 'url', 'link', 'text', 'value']) {
      const v = o[key];
      if (v != null && String(v).trim()) return String(v).trim();
    }
  }
  const s = String(raw).trim();
  const hyper =
    s.match(/HYPERLINK\s*\(\s*"([^"]+)"/i) ||
    s.match(/HYPERLINK\s*\(\s*'([^']+)'/i);
  if (hyper?.[1]) return hyper[1].trim();
  return s;
}

function findHeaderByAliases(
  aliases: readonly string[],
  headers?: string[],
): string | null {
  if (!headers?.length) return null;
  const wanted = new Set(aliases.map(normalizeHeader));
  for (const h of headers) {
    const n = normalizeHeader(h);
    if (n && wanted.has(n)) return h;
  }
  return null;
}

function rowEntries(
  row: SheetRowLike,
  headers?: string[],
): Array<{ header: string; value: string }> {
  const out: Array<{ header: string; value: string }> = [];
  const seen = new Set<string>();
  const push = (header: string, raw: unknown) => {
    if (!header || seen.has(header)) return;
    seen.add(header);
    out.push({ header, value: unwrapSheetCellValue(raw) });
  };

  if (headers?.length) {
    for (const h of headers) push(h, row.get(h));
  }

  if (typeof row.toObject === 'function') {
    const obj = row.toObject() || {};
    for (const [h, v] of Object.entries(obj)) push(h, v);
  }

  return out;
}

function collectDriveFromRow(
  row: SheetRowLike,
  headers?: string[],
): { url_imagen?: string; carpeta_drive?: string } {
  const files: string[] = [];
  const folders: string[] = [];
  const seen = new Set<string>();

  const pushFile = (raw: string) => {
    for (const part of raw
      .split(/[\n,;|]+/)
      .map((s) => s.trim())
      .filter(Boolean)) {
      if (/\/(?:drive\/)?folders\//i.test(part)) continue;
      if (
        !extractDriveFileId(part) &&
        !/drive\.google\.com|docs\.google\.com/i.test(part)
      ) {
        continue;
      }
      if (/google\.com\/maps/i.test(part)) continue;
      const key = part.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      files.push(part);
    }
  };
  const pushFolder = (raw: string) => {
    for (const part of raw
      .split(/[\n,;|]+/)
      .map((s) => s.trim())
      .filter(Boolean)) {
      if (/\/file\/d\//i.test(part)) continue;
      const id = extractDriveFolderId(part);
      if (!id) continue;
      if (seen.has(`folder:${id}`)) continue;
      seen.add(`folder:${id}`);
      folders.push(part);
    }
  };

  for (const { header, value } of rowEntries(row, headers)) {
    if (!value) continue;
    const n = normalizeHeader(header);
    if (isStreetViewOrMapsHeader(n)) continue;

    const looksFolderHeader =
      (n.includes('carpeta') || n.includes('folder')) &&
      (n.includes('drive') ||
        n.includes('foto') ||
        n.includes('imagen') ||
        n.includes('google'));
    const looksFileHeader =
      !looksFolderHeader &&
      ((n.includes('imagen') &&
        (n.includes('url') ||
          n.includes('drive') ||
          n.includes('link') ||
          n.includes('enlace'))) ||
        (n.includes('foto') &&
          (n.includes('url') ||
            n.includes('drive') ||
            n.includes('link') ||
            n.includes('enlace'))) ||
        n.includes('imagenes drive') ||
        n.includes('fotos drive') ||
        n === 'fotos' ||
        n === 'imagenes' ||
        n === 'google drive' ||
        n === 'drive' ||
        n.includes('url imagen') ||
        n.includes('url foto'));

    if (looksFolderHeader || /\/(?:drive\/)?folders\//i.test(value)) {
      pushFolder(value);
    }
    if (looksFileHeader || /\/file\/d\/|drive\.google\.com/i.test(value)) {
      pushFile(value);
    }
  }

  return {
    ...(files.length ? { url_imagen: files.join(', ') } : {}),
    ...(folders.length ? { carpeta_drive: folders.join(', ') } : {}),
  };
}

/** Columna P de esta fila. Es la imagen principal, aunque haya otros enlaces Drive. */
function readColumnPImageUrl(row: SheetRowLike): string {
  if (typeof row.getByColumnLetter !== 'function') return '';
  return sanitizeValue(
    unwrapSheetCellValue(row.getByColumnLetter(SHEET_COL_URL_IMAGEN)),
  );
}

function splitImageParts(raw: string): string[] {
  return raw
    .split(/[\n,;|]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** La URL de la columna P queda la primera: esa es la destacada en WordPress. */
function withPrincipalImageFirst(principal: string, scanned?: string): string {
  const parts: string[] = [];
  const seen = new Set<string>();
  const push = (raw: string) => {
    for (const part of splitImageParts(raw)) {
      const key = (extractDriveFileId(part) || part).toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      parts.push(part);
    }
  };
  if (principal) push(principal);
  if (scanned) push(scanned);
  return parts.join(', ');
}

function readSheetCell(
  row: SheetRowLike,
  columns: readonly string[],
  cleanSymbols = false,
  headers?: string[],
): string {
  const resolved = findHeaderByAliases(columns, headers);
  const tryHeaders = resolved ? [resolved, ...columns] : [...columns];
  const seen = new Set<string>();
  for (const column of tryHeaders) {
    if (!column || seen.has(column)) continue;
    seen.add(column);
    const value = sanitizeValue(
      unwrapSheetCellValue(row.get(column)),
      cleanSymbols,
    );
    if (value) return value;
  }
  return '';
}

/** Lee el ID de WordPress ya guardado en la fila (idempotencia). */
export function readWpPostIdFromSheetRow(row: SheetRowLike): number | undefined {
  for (const header of WP_POST_ID_SHEET_HEADERS) {
    const raw = unwrapSheetCellValue(row.get(header));
    if (!raw) continue;
    if (/^\d+$/.test(raw)) return Number(raw);
  }
  return undefined;
}

/** Convierte una fila de Localizados al CAD esperado por property-mapper. */
export function sheetRowToCad(
  row: SheetRowLike,
  headers?: string[],
): RetellCad {
  const cad: RetellCad = {};

  for (const { cadKey, columns, cleanSymbols } of SHEET_TO_CAD) {
    const value = readSheetCell(row, columns, cleanSymbols, headers);
    if (value) {
      cad[cadKey] = value;
    }
  }

  const fromHeader = cad.url_imagen;
  const drive = collectDriveFromRow(row, headers);
  const principal = readColumnPImageUrl(row) || fromHeader || '';
  const urlImagen = withPrincipalImageFirst(principal, drive.url_imagen);
  if (urlImagen) cad.url_imagen = urlImagen;
  if (drive.carpeta_drive) cad.carpeta_drive = drive.carpeta_drive;

  // País (CI) y dirección (CX) de esta fila, nunca de una cabecera parecida ni de otra fila.
  if (typeof row.getByColumnLetter === 'function') {
    const pais = sanitizeValue(row.getByColumnLetter(SHEET_COL_PAIS));
    const direccion = sanitizeValue(row.getByColumnLetter(SHEET_COL_DIRECCION));
    if (pais) cad.pais = pais;
    else delete cad.pais;
    if (direccion) cad.direccion = direccion;
    else delete cad.direccion;
  }

  return cad;
}

/** Objeto callData compatible con buildEstatePropertyPayload / createPropertyPost. */
export function sheetRowToCallData(
  row: SheetRowLike,
  headers?: string[],
): {
  call_id?: string;
  call_analysis: {
    call_summary?: string;
    custom_analysis_data: RetellCad;
  };
} {
  const callId = readSheetCell(row, ['Call ID'], false, headers);
  const cad = sheetRowToCad(row, headers);
  const summary = readSheetCell(row, ['Información adicional'], false, headers);

  return {
    call_id: callId || undefined,
    call_analysis: {
      call_summary: summary || undefined,
      custom_analysis_data: cad,
    },
  };
}
