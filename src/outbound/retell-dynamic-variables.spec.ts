import {
  RETELL_OUTBOUND_VARIABLE_KEYS,
  buildRetellDynamicVariables,
  resolveOutboundContactIndex,
} from './retell-dynamic-variables';

describe('buildRetellDynamicVariables', () => {
  function fakeRow(values: Record<string, string | undefined>) {
    return {
      get: (header: string) => values[header],
    };
  }

  it('incluye todas las claves del System Prompt Retell (53)', () => {
    const { variables } = buildRetellDynamicVariables(fakeRow({}));
    expect(Object.keys(variables).sort()).toEqual(
      [...RETELL_OUTBOUND_VARIABLE_KEYS].sort(),
    );
  });

  it('lee Municipio exactamente de la columna Municipio (Inca, no Palma)', () => {
    const { variables: vars, missing } = buildRetellDynamicVariables(
      fakeRow({
        'Tipo de inmueble': 'Local Comercial',
        'Disponibilidad del local': 'Disponible',
        Municipio: 'Inca',
        'Pueblo/Barrio/distrito': 'Palma',
        Provincia: 'Illes Balears',
      }),
      { phoneE164: '+34600111222', contactIndex: 1 },
    );

    expect(vars.municipio).toBe('Inca');
    expect(vars.tipo_inmueble).toBe('Local Comercial');
    expect(vars.disponibilidad).toBe('Disponible');
    expect(vars.pueblo_barrio).toBe('Palma');
    expect(vars.municipio).not.toBe('Palma');
    expect(missing).not.toContain('municipio');
  });

  it('envía string vacío (no omite la clave) cuando falta un valor', () => {
    const { variables: vars, missing } = buildRetellDynamicVariables(
      fakeRow({
        Municipio: 'Felanitx',
        'Tipo de inmueble': 'Nave',
        'Disponibilidad del local': '',
      }),
    );

    expect(vars.municipio).toBe('Felanitx');
    expect(vars.disponibilidad).toBe('');
    expect(missing).toContain('disponibilidad');
    expect(Object.prototype.hasOwnProperty.call(vars, 'disponibilidad')).toBe(
      true,
    );
  });

  it('resuelve nombre_interlocutor y target_contact según teléfono', () => {
    const row = fakeRow({
      Telefono2: '+34 611 222 333',
      'Nombre contacto2': 'Carlos Test',
      'Contacto2 por': 'Particular',
    });

    expect(resolveOutboundContactIndex(row, '+34611222333')).toBe(2);

    const { variables } = buildRetellDynamicVariables(row, {
      phoneE164: '+34611222333',
    });
    expect(variables.nombre_interlocutor).toBe('Carlos Test');
    expect(variables.target_contact).toBe('contacto_2');
    expect(variables.contacto_2_por).toBe('Particular');
  });

  it('mapea publicacion_autorizada? con el signo de interrogación exacto', () => {
    const { variables } = buildRetellDynamicVariables(
      fakeRow({ 'Publicacion Autorizada?': 'SI' }),
    );
    expect(variables['publicacion_autorizada?']).toBe('SI');
  });
});
