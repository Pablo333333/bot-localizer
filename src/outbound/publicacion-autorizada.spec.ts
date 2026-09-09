import {
  findPublicacionAutorizadaHeader,
  isPublicacionAutorizadaSi,
  readPublicacionAutorizadaRaw,
} from './publicacion-autorizada';

function fakeRow(values: Record<string, string | undefined>) {
  return { get: (h: string) => values[h] };
}

describe('isPublicacionAutorizadaSi (por nombre de cabecera)', () => {
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

  it('no usa índice de columna: sin cabecera por nombre → false', () => {
    const headers = Array.from({ length: 14 }, (_, i) => `Col${i}`);
    headers[13] = 'ColN';
    expect(isPublicacionAutorizadaSi(fakeRow({ ColN: 'SI' }), headers)).toBe(
      false,
    );
    expect(findPublicacionAutorizadaHeader(headers)).toBeNull();
  });

  it('resuelve header fuzzy por nombre aunque cambie de posición', () => {
    const headers = [
      'Call ID',
      'Municipio',
      'Publicacion Autorizada ?',
      'Otra',
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
