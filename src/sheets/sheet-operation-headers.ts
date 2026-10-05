/**
 * Cabeceras de Localizados para operación (columna F) y modalidad de traspaso (columna G).
 * La lectura es por nombre de cabecera, no por la letra fija: si Toni renombra
 * o mueve la columna, se localiza "Operación" / "Modalidad de Traspaso".
 */

export const OPERACION_HEADER_ALIASES = [
  'Operación',
  'Operacion',
  'Contrato',
] as const;

export const TRASPASO_MODALIDAD_HEADER_ALIASES = [
  'Modalidad de Traspaso',
  'Modalidad de traspaso',
  'Modalidad traspaso',
  'Traspaso',
] as const;

/**
 * Columna H de Localizados: solo SI/NO de la disponibilidad confirmada en la llamada.
 * No es Operación ni la modalidad de traspaso.
 */
export const DISPONIBILIDAD_HEADER_ALIASES = [
  'Disponibilidad (SI/NO)',
  'Disponibilidad confirmada',
  'Disponibilidad llamada',
  'Disponibilidad',
] as const;

const OPERATION_ORDER = ['Venta', 'Traspaso', 'Alquiler'] as const;

export function normalizeSheetHeader(raw: string): string {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[_?/]+/g, ' ')
    .replace(/\s+/g, ' ');
}

/**
 * Primera cabecera real que coincide con los alias (prioridad de la lista)
 * o con el predicado fuzzy. Nunca devuelve un índice de columna.
 */
export function findSheetHeader(
  headerValues: readonly string[] | undefined,
  aliases: readonly string[],
  fuzzy?: (normalized: string) => boolean,
): string | null {
  if (!headerValues?.length) return null;

  for (const alias of aliases) {
    const wanted = normalizeSheetHeader(alias);
    if (!wanted) continue;
    for (const header of headerValues) {
      if (normalizeSheetHeader(header) === wanted) return header;
    }
  }

  if (!fuzzy) return null;
  for (const header of headerValues) {
    const normalized = normalizeSheetHeader(header);
    if (normalized && fuzzy(normalized)) return header;
  }
  return null;
}

export function findOperacionHeader(
  headerValues?: readonly string[],
): string | null {
  return findSheetHeader(headerValues, OPERACION_HEADER_ALIASES, (normalized) => {
    if (normalized.includes('precio') || normalized.includes('traspaso')) {
      return false;
    }
    return normalized === 'operacion' || normalized.startsWith('operacion ');
  });
}

export function findTraspasoModalidadHeader(
  headerValues?: readonly string[],
): string | null {
  return findSheetHeader(
    headerValues,
    TRASPASO_MODALIDAD_HEADER_ALIASES,
    (normalized) => {
      if (normalized.includes('precio')) return false;
      if (normalized.includes('disponibilidad')) return false;
      if (normalized.includes('modalidad') && normalized.includes('traspaso')) {
        return true;
      }
      return normalized === 'traspaso';
    },
  );
}

/**
 * Cabecera de la columna H. "Disponibilidad del local" es otro campo
 * y no cuenta: aquí solo entra el SI/NO confirmado en la llamada.
 */
export function findDisponibilidadHeader(
  headerValues?: readonly string[],
): string | null {
  return findSheetHeader(
    headerValues,
    DISPONIBILIDAD_HEADER_ALIASES,
    (normalized) => {
      if (
        normalized.includes('local') ||
        normalized.includes('operacion') ||
        normalized.includes('traspaso') ||
        normalized.includes('precio')
      ) {
        return false;
      }
      return (
        normalized === 'disponibilidad' ||
        normalized.startsWith('disponibilidad ')
      );
    },
  );
}

/** SI o NO. Venta, alquiler y traspaso no son disponibilidad. */
export function parseDisponibilidadConfirmada(raw: unknown): 'SI' | 'NO' | '' {
  const s = String(raw ?? '')
    .trim()
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  if (!s) return '';
  if (parseOperationList(s).length > 0) return '';
  if (
    ['SI', 'YES', 'TRUE', '1', 'DISPONIBLE', 'DISPONIBLE AHORA'].includes(s)
  ) {
    return 'SI';
  }
  if (
    ['NO', 'FALSE', '0', 'NO DISPONIBLE', 'OCUPADO', 'NO DISPONIBLE AHORA'].includes(
      s,
    )
  ) {
    return 'NO';
  }
  return '';
}

/** Alquiler / Venta / Traspaso, en ese orden canónico de escritura. */
export function parseOperationList(raw: unknown): string[] {
  const stripped = String(raw ?? '')
    .trim()
    .replace(/venta\s+con\s+inmueble/gi, ' ')
    .replace(/venta\s+negocio/gi, ' ');
  const found = new Set<string>();
  if (/traspaso/i.test(stripped)) found.add('Traspaso');
  if (/alquiler|renta/i.test(stripped)) found.add('Alquiler');
  if (/\bventa\b|\bcompra\b/i.test(stripped)) found.add('Venta');
  return OPERATION_ORDER.filter((item) => found.has(item));
}

export function formatOperationCell(raw: unknown): string {
  return parseOperationList(raw).join(', ');
}

/** Venta negocio | Venta con inmueble. Cualquier otro texto se descarta. */
export function parseTraspasoModalidad(raw: unknown): string {
  const s = String(raw ?? '').trim();
  if (/venta\s+con\s+inmueble/i.test(s)) return 'Venta con inmueble';
  if (/venta\s+negocio/i.test(s)) return 'Venta negocio';
  return '';
}
