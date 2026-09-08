import {
  buildFallbackCommercialDescription,
  looksLikeTechnicalDump,
  pickExistingCommercialDescription,
} from './commercial-description';

describe('commercial-description', () => {
  it('detecta fichas técnicas planas', () => {
    expect(looksLikeTechnicalDump('<h3>Detalles del Inmueble</h3>')).toBe(true);
    expect(
      looksLikeTechnicalDump('<p>Oportunidad de local en el centro.</p>'),
    ).toBe(false);
  });

  it('reutiliza descripción comercial existente y descarta dumps', () => {
    expect(
      pickExistingCommercialDescription({
        descripcion_propietario:
          '<p>Local luminoso junto a la playa, ideal para hostelería de temporada.</p>',
      }),
    ).toContain('playa');

    expect(
      pickExistingCommercialDescription({
        descripcion_propietario: '<h3>Detalles del Inmueble</h3><ul><li>Precio</li>',
      }),
    ).toBe('');
  });

  it('fallback comercial no es una ficha técnica', () => {
    const html = buildFallbackCommercialDescription(
      {
        tipo_inmueble: 'Local Comercial',
        municipio: 'Inca',
        nombre_via: 'Gran Vía',
        estado: 'Buen estado',
        negocio_anterior: 'Cafetería',
      },
      'Resumen corto',
    );
    expect(html).toContain('Inca');
    expect(html).not.toMatch(/Detalles del Inmueble/);
    expect(html).not.toMatch(/<li><strong>Precio/);
  });
});
