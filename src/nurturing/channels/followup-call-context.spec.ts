import {
  buildFollowupOpening,
  buildFollowupSheetVariables,
} from './followup-call-context';

describe('contexto de la rellamada', () => {
  const row = {
    get: (header: string) =>
      (
        {
          'Tipo de inmueble': 'Local',
          'Tipo Via': 'Calle',
          'Nombre via': 'de la Fuente',
          'Numero Via': '3',
          'Pueblo/Barrio/distrito': 'Zona Sindicato',
          Municipio: 'Palma',
          Provincia: 'Baleares',
          'Superficie Total': '200',
          'Precio VENTA': '100000',
          'Precio ALQUILER/mes': '0',
          'Gastos de comunidad': '0',
          'Nombre contacto1': 'Antonio',
          Telefono1: '34644408099',
        } as Record<string, string>
      )[header],
  };

  it('pasa dirección, zona, tipo y superficie, y omite los ceros', () => {
    const vars = buildFollowupSheetVariables(row, {
      phoneE164: '+34644408099',
      contactIndex: 1,
    });
    expect(vars.tipo_inmueble).toBe('Local');
    expect(vars.nombre_via).toBe('de la Fuente');
    expect(vars.numero_via).toBe('3');
    expect(vars.pueblo_barrio).toBe('Zona Sindicato');
    expect(vars.municipio).toBe('Palma');
    expect(vars.superficie_total).toBe('200');
    expect(vars.precio_venta).toBe('cien mil euros');
    expect(vars.precio_alquiler).toBe('');
    expect(vars.gastos_comunidad).toBe('');
    expect(vars.nombre_interlocutor).toBe('Antonio');
  });

  it('el saludo nombra el inmueble concreto', () => {
    const vars = buildFollowupSheetVariables(row, { contactIndex: 1 });
    const opening = buildFollowupOpening(vars);
    expect(opening).toContain('Antonio');
    expect(opening).toContain('por el local');
    expect(opening).toContain('Calle de la Fuente 3');
    expect(opening).toContain('Zona Sindicato');
    expect(opening).toContain('Palma');
    expect(opening).toContain('200 metros');
    expect(opening).not.toMatch(/Chamberí|Madrid/);
  });

  it('sin ficha no inventa una zona', () => {
    const opening = buildFollowupOpening({});
    expect(opening).toContain('inmueble que tenemos localizado');
    expect(opening).not.toMatch(/Palma|Madrid|Chamberí|metros/);
  });
});
