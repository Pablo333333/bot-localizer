import { formatE164Spain, phoneDedupeKey } from '../utils/phone.util';
import type { OwnerResolveResult, OwnerSheetMatch } from './owner-reply.types';

type SheetRowLike = {
  rowNumber: number;
  get: (header: string) => unknown;
};

const PHONE_HEADERS = [
  'Teléfono contacto1',
  'Telefono1',
  'Telefono2',
  'Telefono3',
] as const;

export function normalizeInboundWhatsappPhone(raw: string): string {
  return formatE164Spain(raw);
}

export function extractSheetRowPhones(row: SheetRowLike): string[] {
  const out: string[] = [];
  for (const h of PHONE_HEADERS) {
    const raw = String(row.get(h) ?? '').trim();
    if (!raw) continue;
    try {
      out.push(formatE164Spain(raw));
    } catch {
      /* ignore invalid */
    }
  }
  return out;
}

export function matchSheetRowsByPhone(
  rows: SheetRowLike[],
  e164: string,
): OwnerSheetMatch[] {
  const key = phoneDedupeKey(e164);
  const matches: OwnerSheetMatch[] = [];
  for (const row of rows) {
    const phones = extractSheetRowPhones(row);
    if (!phones.some((p) => phoneDedupeKey(p) === key)) continue;
    const title =
      String(row.get('Direccion titulo anuncio') ?? '').trim() ||
      String(row.get('Título') ?? '').trim() ||
      String(row.get('Titulo') ?? '').trim() ||
      undefined;
    matches.push({
      rowNumber: row.rowNumber,
      phone: e164,
      title,
    });
  }
  return matches;
}

export function buildOwnerResolveResult(params: {
  e164: string;
  leadIds: string[];
  sheetRows: OwnerSheetMatch[];
}): OwnerResolveResult {
  const ambiguous = params.sheetRows.length > 1;
  const isAdvertiser =
    params.leadIds.length > 0 || params.sheetRows.length > 0;
  return {
    e164: params.e164,
    leadIds: params.leadIds,
    sheetRows: params.sheetRows,
    ambiguous,
    isAdvertiser,
  };
}
