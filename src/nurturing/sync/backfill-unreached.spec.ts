import {
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
});
