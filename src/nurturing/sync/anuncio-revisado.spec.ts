import {
  findAnuncioRevisadoHeader,
  isAnuncioRevisadoSi,
} from './anuncio-revisado';

describe('anuncio-revisado', () => {
  function fakeRow(values: Record<string, string | undefined>) {
    return { get: (h: string) => values[h] };
  }

  it('detecta cabecera exacta y columna J', () => {
    expect(
      findAnuncioRevisadoHeader([
        'A',
        'B',
        'C',
        'D',
        'E',
        'F',
        'G',
        'H',
        'I',
        'Anuncio Revisado?',
      ]),
    ).toBe('Anuncio Revisado?');
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
