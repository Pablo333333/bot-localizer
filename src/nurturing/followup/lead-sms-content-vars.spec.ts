import {
  buildLeadPropertyMetadataFromSheet,
  buildSeguimientoSmsContentVariables,
  resolveLeadContactName,
  resolveLeadPropertyLabel,
} from './lead-sms-content-vars';

describe('lead-sms-content-vars', () => {
  it('nombre de contacto se resuelve desde lead.name', () => {
    expect(
      resolveLeadContactName({ name: 'María López', metadata: {} }),
    ).toBe('María López');
  });

  it('nombre cae a metadata / callVars si no hay name', () => {
    expect(
      resolveLeadContactName(
        { name: null, metadata: { nombre_contacto_1: 'Ana' } },
        { nombre_interlocutor: 'Ignorado' },
      ),
    ).toBe('Ana');
    expect(
      resolveLeadContactName(
        { name: null, metadata: {} },
        { nombre_contacto_1: 'Carlos' },
      ),
    ).toBe('Carlos');
  });

  it('{{1}} prioriza Direccion titulo anuncio / propiedad', () => {
    expect(
      resolveLeadPropertyLabel({
        metadata: {
          propiedad: 'Local Gran Vía 12, Madrid',
          municipio: 'Otro',
        },
      }),
    ).toBe('Local Gran Vía 12, Madrid');

    expect(
      resolveLeadPropertyLabel(
        { metadata: { municipio: 'Palma' } },
        { 'Direccion titulo anuncio': 'Local en Calle Falsa' },
      ),
    ).toBe('Local en Calle Falsa');
  });

  it('{{1}} compone dirección desde vía + municipio', () => {
    expect(
      resolveLeadPropertyLabel({
        metadata: {
          tipo_via: 'Calle',
          nombre_via: 'Mayor',
          numero_via: '5',
          municipio: 'Inca',
        },
      }),
    ).toBe('Calle Mayor 5, Inca');
  });

  it('buildSeguimientoSmsContentVariables inyecta el título en Twilio {{1}}', () => {
    expect(
      buildSeguimientoSmsContentVariables({
        name: 'Toni',
        metadata: {
          direccion_titulo_anuncio: 'Local test Palma',
        },
      }),
    ).toEqual({
      '1': 'Local test Palma',
    });
  });

  it('buildLeadPropertyMetadataFromSheet lee cabeceras Localizados', () => {
    const row: Record<string, string> = {
      Municipio: 'Manacor',
      'Tipo de inmueble': 'Local',
      'Tipo Via': 'Carrer',
      'Nombre via': 'Nou',
      'Numero Via': '10',
      'Direccion titulo anuncio': '',
    };
    const meta = buildLeadPropertyMetadataFromSheet((h) => row[h]);
    expect(meta.municipio).toBe('Manacor');
    expect(meta.nombre_via).toBe('Nou');
    expect(meta.propiedad).toBe('Carrer Nou 10, Manacor');
  });
});
