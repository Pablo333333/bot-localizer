/** Intenciones de respuesta de anunciante (WhatsApp inbound). */
export type OwnerReplyIntent =
  | 'NO_DISPONIBLE'
  | 'DISPONIBLE'
  | 'NO_INTERESADO'
  | 'NO_CONTACTAR'
  | 'AMBIGUO';

export type OwnerReplyClassifyResult = {
  intent: OwnerReplyIntent;
  confidence: number;
  reason: string;
  /** Motivo libre para Sheets / logs */
  motive?: string;
};

export type OwnerSheetMatch = {
  rowNumber: number;
  phone: string;
  title?: string;
};

export type OwnerResolveResult = {
  e164: string;
  leadIds: string[];
  sheetRows: OwnerSheetMatch[];
  ambiguous: boolean;
  isAdvertiser: boolean;
};

export type OwnerReplyActionResult = {
  intent: OwnerReplyIntent;
  reply: string;
  dryRun: boolean;
  actions: string[];
  sheetRowNumbers: number[];
  leadIds: string[];
  ambiguous: boolean;
};
