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

  it('escribe Descripción por el propietario si la llamada aporta texto nuevo', () => {
    const updates = buildCadPropertyUpdates(
      { descripcion_propietario: 'Local reformado con mucha luz natural.' },
      (h) =>
        h === 'Descripción por el propietario' ? 'Texto antiguo del cartel' : undefined,
    );
    expect(updates['Descripción por el propietario']).toContain('luz natural');
  });

  it('no sobrescribe Información adicional con call_summary genérico', () => {
    const updates = buildCadPropertyUpdates(
      {
        informacion_adicional: '',
        info_adicional: '',
      },
      (h) =>
        h === 'Información adicional'
          ? 'Datos previos del cartel'
          : undefined,
    );

    expect(updates).toEqual({});
  });

  it('actualiza Información adicional solo con dato explícito del CAD', () => {
    const updates = buildCadPropertyUpdates(
      { informacion_adicional: 'Tiene terraza trasera' },
      (h) => (h === 'Información adicional' ? 'Datos previos' : undefined),
    );

    expect(updates).toEqual({
      'Información adicional': 'Tiene terraza trasera',
    });
  });

  it('no escribe pipeline de lead (pendiente/ilocalizable) en columna Estado del inmueble', () => {
    const updates = buildCadPropertyUpdates(
      { estado: 'pendiente', precio_alquiler: '2000' },
      getExisting,
    );
    expect(updates).not.toHaveProperty('Estado');
    expect(updates['Precio ALQUILER/mes']).toBe('2000');
  });

  it('registra la ficha que Retell devuelve en una llamada exitosa', () => {
    const updates = buildCadPropertyUpdates(
      {
        first_name: 'Tony',
        nombre_contacto_1: 'Tony',
        nombre_via: 'Sindicato',
        numero_via: 'veinte',
        tipo_via: 'calle',
        precio_venta: '110000',
        precio_alquiler: '1200',
        negocio_anterior: 'Peluquería',
        email: 'Pepe@gmail.com',
        email_propietario_gestor: 'Pepe@gmail.com',
        descripcion_generada:
          'Local en buen estado ubicado en calle Sindicato, Zona Sindicato, Palma.',
        'publicacion_autorizada?': 'SI',
        contacto_1_por: 'Whatsapp y Email',
        pueblo_barrio: 'Zona Sindicato',
        municipio: 'Palma',
        numero_plantas: '1',
        terraza_patio: 'Patio de 7 metros cuadrados',
      },
      (header) => {
        const previous: Record<string, string> = {
          'Nombre contacto1': 'Antonio',
          'Nombre via': 'Socorrs',
          'Numero Via': '68',
          'Precio VENTA': '125000',
          'Precio ALQUILER/mes': '1000',
          'Negocio anterior': 'Cafetería',
          'Email propietario-gestor': 'avecillaalvarez@gmail.com',
          'Email Avisos': 'avecillaalvarez@gmail.com',
          'Descripción por el propietario': 'Local super bien situado, junto al Teatro Cervantes.',
          'Publicacion Autorizada?': 'NO',
          'Contacto1 por': 'Llamada de teléfono',
          'Pueblo/Barrio/distrito': 'Zona Sindicato',
          Municipio: 'Palma',
        };
        return previous[header];
      },
    );

    expect(updates['Nombre contacto1']).toBe('Tony');
    expect(updates['Nombre via']).toBe('Sindicato');
    expect(updates['Numero Via']).toBe('veinte');
    expect(updates['Precio VENTA']).toBe('110000');
    expect(updates['Precio ALQUILER/mes']).toBe('1200');
    expect(updates['Negocio anterior']).toBe('Peluquería');
    expect(updates['Email propietario-gestor']).toBe('Pepe@gmail.com');
    expect(updates['Email Avisos']).toBe('Pepe@gmail.com');
    expect(updates['Descripción por el propietario']).toContain('Sindicato');
    expect(updates['Publicacion Autorizada?']).toBe('SI');
    expect(updates['Contacto1 por']).toBe('Whatsapp y Email');
    expect(updates['Terraza propia (Superficie m2)']).toBe(
      'Patio de 7 metros cuadrados',
    );
    expect(updates).not.toHaveProperty('Municipio');
    expect(updates).not.toHaveProperty('Pueblo/Barrio/distrito');
  });

  it('escribe nombre de contacto sin target_contact y URL imagen', () => {
    const updates = buildCadPropertyUpdates(
      {
        nombre_contacto: 'María López',
        url_imagen: 'https://drive.google.com/file/d/abc123/view',
      },
      () => undefined,
    );
    expect(updates['Nombre contacto1']).toBe('María López');
    expect(updates['URL imagen']).toContain('drive.google.com');
  });
});
