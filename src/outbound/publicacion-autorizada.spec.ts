import {
  findPublicacionAutorizadaHeader,
  isPublicacionAutorizadaSi,
  readPublicacionAutorizadaRaw,
} from './publicacion-autorizada';

function fakeRow(values: Record<string, string | undefined>) {
  return { get: (h: string) => values[h] };
}

describe('isPublicacionAutorizadaSi (columna N)', () => {
  it('acepta SI ignorando mayúsculas, acentos y espacios', () => {
    expect(
      isPublicacionAutorizadaSi(fakeRow({ 'Publicacion Autorizada?': 'SI' })),
    ).toBe(true);
    expect(
      isPublicacionAutorizadaSi(fakeRow({ 'Publicacion Autorizada?': ' sí ' })),
    ).toBe(true);
    expect(
      isPublicacionAutorizadaSi(fakeRow({ 'Publicación Autorizada?': 'Si' })),
    ).toBe(true);
  });

  it('rechaza vacío, NO u otro valor', () => {
    expect(isPublicacionAutorizadaSi(fakeRow({}))).toBe(false);
    expect(
      isPublicacionAutorizadaSi(fakeRow({ 'Publicacion Autorizada?': '' })),
    ).toBe(false);
    expect(
      isPublicacionAutorizadaSi(fakeRow({ 'Publicacion Autorizada?': 'NO' })),
    ).toBe(false);
    expect(
      isPublicacionAutorizadaSi(
        fakeRow({ 'Publicacion Autorizada?': 'Pendiente' }),
      ),
    ).toBe(false);
  });

  it('lee columna N (índice 13) si el header no coincide', () => {
    const headers = Array.from({ length: 14 }, (_, i) => `Col${i}`);
    headers[13] = 'ColN';
    expect(isPublicacionAutorizadaSi(fakeRow({ ColN: 'SI' }), headers)).toBe(
      true,
    );
    expect(isPublicacionAutorizadaSi(fakeRow({ ColN: 'NO' }), headers)).toBe(
      false,
    );
  });

  it('resuelve header fuzzy (espacios / tipografía distinta)', () => {
    const headers = [
      'A',
      'B',
      'C',
      'D',
      'E',
      'F',
      'G',
      'H',
      'I',
      'J',
      'K',
      'L',
      'M',
      'Publicacion Autorizada ?',
    ];
    expect(findPublicacionAutorizadaHeader(headers)).toBe(
      'Publicacion Autorizada ?',
    );
    expect(
      isPublicacionAutorizadaSi(
        fakeRow({ 'Publicacion Autorizada ?': 'SI' }),
        headers,
      ),
    ).toBe(true);
    expect(
      readPublicacionAutorizadaRaw(
        fakeRow({ 'Publicacion Autorizada ?': 'SI' }),
        headers,
      ),
    ).toBe('SI');
  });
});
