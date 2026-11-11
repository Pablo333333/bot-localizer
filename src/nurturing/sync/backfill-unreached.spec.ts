import {
  BACKFILL_T0_LOG_PREFIX,
  META_BACKFILL_T0_CLAIMED_AT,
  META_BACKFILL_T0_SENT_AT,
  META_BACKFILL_T0_STATUS,
  hasBackfillT0WhatsappRecord,
  isBackfillT0CommunicationSummary,
  isBackfillUnreachedCandidate,
  sheetRowHasSuccessfulConversion,
  sheetRowWasCalled,
} from './backfill-unreached';

function row(values: Record<string, string>) {
  return {
    get: (header: string) => values[header] ?? '',
  };
}

describe('backfill-unreached', () => {
  it('detecta Llamado=SI o Call ID', () => {
    expect(sheetRowWasCalled(row({ Llamado: 'SI' }))).toBe(true);
    expect(
      sheetRowWasCalled(row({ 'Call ID': 'call_abc', Llamado: '' })),
    ).toBe(true);
    expect(sheetRowWasCalled(row({ Llamado: 'NO' }))).toBe(false);
  });

  it('conversión exitosa por Propietario contactado? o Publicacion Autorizada?', () => {
    expect(
      sheetRowHasSuccessfulConversion(
        row({ 'Propietario contactado?': '02/10/2026' }),
      ),
    ).toBe(true);
    expect(
      sheetRowHasSuccessfulConversion(
        row({ 'Publicacion Autorizada?': 'SI' }),
      ),
    ).toBe(true);
    expect(
      sheetRowHasSuccessfulConversion(
        row({
          'Propietario contactado?': 'NO',
          'Publicacion Autorizada?': 'NO',
        }),
      ),
    ).toBe(false);
  });

  it('candidato = llamado sin conversión', () => {
    expect(
      isBackfillUnreachedCandidate(
        row({
          Llamado: 'SI',
          'Call ID': 'call_1',
          'Propietario contactado?': 'NO',
          'Publicacion Autorizada?': '',
        }),
      ),
    ).toBe(true);

    expect(
      isBackfillUnreachedCandidate(
        row({
          Llamado: 'SI',
          'Propietario contactado?': 'SI',
        }),
      ),
    ).toBe(false);

    expect(
      isBackfillUnreachedCandidate(
        row({
          Llamado: '',
          'Propietario contactado?': 'NO',
        }),
      ),
    ).toBe(false);
  });

  it('detecta marca durable T+0 backfill en metadata', () => {
    expect(hasBackfillT0WhatsappRecord(null)).toBe(false);
    expect(hasBackfillT0WhatsappRecord({})).toBe(false);
    expect(
      hasBackfillT0WhatsappRecord({
        [META_BACKFILL_T0_CLAIMED_AT]: '2026-11-11T12:00:00.000Z',
      }),
    ).toBe(true);
    expect(
      hasBackfillT0WhatsappRecord({
        [META_BACKFILL_T0_SENT_AT]: '2026-11-11T12:00:01.000Z',
      }),
    ).toBe(true);
    expect(
      hasBackfillT0WhatsappRecord({
        [META_BACKFILL_T0_STATUS]: 'failed',
      }),
    ).toBe(true);
    expect(
      hasBackfillT0WhatsappRecord({
        [META_BACKFILL_T0_STATUS]: 'pending',
      }),
    ).toBe(false);
  });

  it('reconoce summaries CommunicationLog de claim/envío T+0', () => {
    expect(isBackfillT0CommunicationSummary(`${BACKFILL_T0_LOG_PREFIX}:claimed`)).toBe(
      true,
    );
    expect(isBackfillT0CommunicationSummary(`${BACKFILL_T0_LOG_PREFIX}:sent`)).toBe(
      true,
    );
    expect(isBackfillT0CommunicationSummary('no_answer_t0:whatsapp')).toBe(false);
  });
});
