import { alreadyHandledAdReason } from './already-handled-ad';

function row(values: Record<string, string>) {
  return { get: (header: string) => values[header] };
}

describe('alreadyHandledAdReason', () => {
  it('Publicación Autorizada? = SI corta la secuencia', () => {
    expect(
      alreadyHandledAdReason(row({ 'Publicación Autorizada?': 'SI' })),
    ).toBe('publicacion_autorizada');
  });

  it('un anuncio ya publicado corta la secuencia', () => {
    expect(alreadyHandledAdReason(row({ 'WP Post ID': '35828' }))).toBe(
      'wp_post_id:35828',
    );
  });

  it('sin SI y sin ficha, la llamada puede seguir', () => {
    expect(
      alreadyHandledAdReason(
        row({
          'Publicación Autorizada?': 'NO',
          'WP Post ID': '',
          Referencia: 'MALL-00000031',
        }),
      ),
    ).toBeNull();
  });
});
