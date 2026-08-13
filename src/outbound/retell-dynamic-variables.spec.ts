import { buildRetellDynamicVariables } from './retell-dynamic-variables';

describe('buildRetellDynamicVariables', () => {
  function fakeRow(values: Record<string, string | undefined>) {
    return {
      get: (header: string) => values[header],
    };
  }

  it('lee Municipio exactamente de la columna Municipio (Inca, no Palma)', () => {
    const vars = buildRetellDynamicVariables(
      fakeRow({
        'Tipo de inmueble': 'Local Comercial',
        'Disponibilidad del local': 'Disponible',
        Municipio: 'Inca',
        'Pueblo/Barrio/distrito': 'Palma',
        Provincia: 'Illes Balears',
      }),
    );

    expect(vars.municipio).toBe('Inca');
    expect(vars.tipo_inmueble).toBe('Local Comercial');
    expect(vars.disponibilidad).toBe('Disponible');
    expect(vars.municipio).not.toBe('Palma');
  });

  it('pasa Felanitx tal cual, sin default Palma', () => {
    const vars = buildRetellDynamicVariables(
      fakeRow({
        Municipio: 'Felanitx',
        'Tipo de inmueble': 'Nave',
        'Disponibilidad del local': '',
      }),
    );

    expect(vars.municipio).toBe('Felanitx');
    expect(vars.disponibilidad).toBe('');
  });

  it('si Municipio está vacío, envía string vacío (no Palma)', () => {
    const vars = buildRetellDynamicVariables(
      fakeRow({
        Municipio: '',
        'Tipo de inmueble': 'Oficina',
      }),
    );

    expect(vars.municipio).toBe('');
    expect(JSON.stringify(vars)).not.toMatch(/Palma/i);
  });
});
