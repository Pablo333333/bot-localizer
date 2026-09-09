import {
  findAnuncioRevisadoHeader,
  isAnuncioRevisadoSi,
} from './anuncio-revisado';

describe('anuncio-revisado', () => {
  function fakeRow(values: Record<string, string | undefined>) {
    return { get: (h: string) => values[h] };
  }

  it('detecta cabecera por nombre (no por índice de columna)', () => {
    expect(
      findAnuncioRevisadoHeader([
        'Call ID',
        'Municipio',
        'Anuncio Revisado?',
        'Otra',
      ]),
    ).toBe('Anuncio Revisado?');
    // Si Toni mueve la columna, sigue encontrándola por nombre
    expect(
      findAnuncioRevisadoHeader(['X', 'Y', 'Anuncio revisado?', 'Z']),
    ).toBe('Anuncio revisado?');
    // Sin cabecera por nombre → null (nunca asume columna J)
    expect(findAnuncioRevisadoHeader(['A', 'B', 'C'])).toBeNull();
  });

  it('solo procesa filas con SI', () => {
    expect(
      isAnuncioRevisadoSi(
        fakeRow({ 'Anuncio Revisado?': 'SI' }),
        ['Anuncio Revisado?'],
      ),
    ).toBe(true);
    expect(
      isAnuncioRevisadoSi(
        fakeRow({ 'Anuncio Revisado?': 'NO' }),
        ['Anuncio Revisado?'],
      ),
    ).toBe(false);
    expect(
      isAnuncioRevisadoSi(
        fakeRow({ 'Anuncio Revisado?': '' }),
        ['Anuncio Revisado?'],
      ),
    ).toBe(false);
  });
});
