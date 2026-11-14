import {
  buildOwnerResolveResult,
  matchSheetRowsByPhone,
} from './owner-reply-resolve';

function row(n: number, values: Record<string, string>) {
  return {
    rowNumber: n,
    get: (h: string) => values[h] ?? '',
  };
}

describe('owner-reply-resolve', () => {
  it('detecta anunciante y ambigüedad multi-fila', () => {
    const rows = [
      row(10, { Telefono1: '615058885', 'Direccion titulo anuncio': 'Local A' }),
      row(20, { Telefono1: '+34615058885', Titulo: 'Local B' }),
      row(30, { Telefono1: '600000000' }),
    ];
    const matches = matchSheetRowsByPhone(rows, '+34615058885');
    expect(matches).toHaveLength(2);
    const resolved = buildOwnerResolveResult({
      e164: '+34615058885',
      leadIds: ['lead1'],
      sheetRows: matches,
    });
    expect(resolved.isAdvertiser).toBe(true);
    expect(resolved.ambiguous).toBe(true);
  });

  it('un solo anuncio no es ambiguo', () => {
    const matches = matchSheetRowsByPhone(
      [row(173, { Telefono1: '615058885' })],
      '+34615058885',
    );
    expect(
      buildOwnerResolveResult({
        e164: '+34615058885',
        leadIds: [],
        sheetRows: matches,
      }).ambiguous,
    ).toBe(false);
  });
});
