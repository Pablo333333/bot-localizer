import {
  fase1LeadHardBlockReason,
  fase1SheetHardBlockReason,
  isLlamadoClearedForRetry,
  shouldBlockOnExistingCallId,
} from './outbound-fase1-guard';

function row(values: Record<string, string>) {
  return { get: (h: string) => values[h] ?? '' };
}

describe('outbound-fase1-guard', () => {
  it('Llamado vacío = retry permitido', () => {
    expect(isLlamadoClearedForRetry('')).toBe(true);
    expect(isLlamadoClearedForRetry('SI')).toBe(false);
    expect(isLlamadoClearedForRetry('INTENTADO')).toBe(false);
  });

  it('Call ID no bloquea si Llamado está vacío', () => {
    expect(
      shouldBlockOnExistingCallId({
        llamadoRaw: '',
        callId: 'call_abc',
      }),
    ).toBe(false);
    expect(
      shouldBlockOnExistingCallId({
        llamadoRaw: 'SI',
        callId: 'call_abc',
      }),
    ).toBe(true);
  });

  it('conversión / WP bloquea (fila 173)', () => {
    const headers = [
      'Propietario contactado?',
      'Publicacion Autorizada?',
      'WP Post ID',
      'Disponibilidad',
    ];
    expect(
      fase1SheetHardBlockReason(
        row({
          'Propietario contactado?': 'SI',
          'Publicacion Autorizada?': 'NO',
          'WP Post ID': '33616',
        }),
        headers,
      ),
    ).toMatch(/Conversión/);
  });

  it('Disponibilidad NO bloquea', () => {
    expect(
      fase1SheetHardBlockReason(
        row({ Disponibilidad: 'NO' }),
        ['Disponibilidad'],
      ),
    ).toMatch(/Disponibilidad/);
  });

  it('doNotContact y enrollment bloquean en BD', () => {
    expect(
      fase1LeadHardBlockReason({
        metadata: { doNotContact: true },
      }),
    ).toMatch(/doNotContact/);
    expect(
      fase1LeadHardBlockReason({
        metadata: { commercial_rejection: true },
      }),
    ).toMatch(/NO INTERESADO/);
    expect(
      fase1LeadHardBlockReason({
        hasActiveOrCompletedEnrollment: true,
      }),
    ).toMatch(/enrollment/);
  });
});
