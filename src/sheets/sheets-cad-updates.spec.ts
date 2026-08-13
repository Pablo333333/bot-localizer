import {
  buildCadPropertyUpdates,
  shouldWriteCell,
  valuesAreEquivalent,
} from './sheets-cad-updates';

describe('shouldWriteCell / valuesAreEquivalent', () => {
  it('no escribe si el extraído viene vacío (conserva original)', () => {
    expect(shouldWriteCell('1500', '')).toBe(false);
    expect(shouldWriteCell('1500', null)).toBe(false);
    expect(shouldWriteCell('1500', 'no especificado')).toBe(false);
    expect(shouldWriteCell('Inca', undefined)).toBe(false);
  });

  it('no escribe si el valor no cambió (precio/superficie equivalentes)', () => {
    expect(valuesAreEquivalent('1500', '1.500 €')).toBe(true);
    expect(valuesAreEquivalent('120 m²', '120')).toBe(true);
    expect(shouldWriteCell('1500', '1500')).toBe(false);
    expect(shouldWriteCell('1500', '1.500')).toBe(false);
    expect(shouldWriteCell('Buen estado', 'buen estado')).toBe(false);
  });

  it('sí escribe si hay un dato nuevo distinto', () => {
    expect(shouldWriteCell('1500', '1800')).toBe(true);
    expect(shouldWriteCell('120', '140')).toBe(true);
    expect(shouldWriteCell('Buen estado', 'Reformado')).toBe(true);
    expect(shouldWriteCell('', '1800')).toBe(true);
    expect(shouldWriteCell('Inca', 'Felanitx')).toBe(true);
  });
});

describe('buildCadPropertyUpdates', () => {
  const existing: Record<string, string> = {
    'Precio ALQUILER/mes': '1500',
    'Superficie util': '110',
    Estado: 'Buen estado',
    Municipio: 'Inca',
    'Tipo de inmueble': 'Local Comercial',
  };
  const getExisting = (h: string) => existing[h];

  it('actualiza solo celdas con valor nuevo no vacío', () => {
    const updates = buildCadPropertyUpdates(
      {
        precio_alquiler: '1800',
        superficie_util: '110',
        estado: 'Reformado',
        municipio: '',
        tipo_inmueble: 'no especificado',
        superficie_total: '200',
      },
      getExisting,
    );

    expect(updates).toEqual({
      'Precio ALQUILER/mes': '1800',
      Estado: 'Reformado',
      'Superficie Total': '200',
    });
    expect(updates).not.toHaveProperty('Superficie util');
    expect(updates).not.toHaveProperty('Municipio');
    expect(updates).not.toHaveProperty('Tipo de inmueble');
  });

  it('no aplica defaults (Buen estado / No consta) si CAD viene vacío', () => {
    const updates = buildCadPropertyUpdates(
      {
        estado: '',
        certificacion: '',
        vado: '',
        precio_alquiler: '',
      },
      getExisting,
    );

    expect(updates).toEqual({});
  });
});
