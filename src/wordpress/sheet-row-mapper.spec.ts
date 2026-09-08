import {
  readWpPostIdFromSheetRow,
  sheetRowToCad,
  sheetRowToCallData,
} from './sheet-row-mapper';

describe('sheet-row-mapper', () => {
  function fakeRow(values: Record<string, string | undefined>) {
    return { get: (h: string) => values[h] };
  }

  it('mapea columnas del Sheet al CAD de WordPress', () => {
    const cad = sheetRowToCad(
      fakeRow({
        'Tipo de inmueble': 'Local Comercial',
        Municipio: 'Inca',
        'Precio ALQUILER/mes': '1.500 €',
        'Superficie util': '95',
        Contrato: 'Alquiler',
      }),
    );

    expect(cad.tipo_inmueble).toBe('Local Comercial');
    expect(cad.municipio).toBe('Inca');
    expect(cad.precio_alquiler).toBe('1500');
    expect(cad.superficie_util).toBe('95');
    expect(cad.contrato).toBe('Alquiler');
  });

  it('lee ID_WP y alias WP Post ID', () => {
    expect(
      readWpPostIdFromSheetRow(fakeRow({ ID_WP: '4242' })),
    ).toBe(4242);
    expect(
      readWpPostIdFromSheetRow(fakeRow({ 'WP Post ID': '99' })),
    ).toBe(99);
    expect(readWpPostIdFromSheetRow(fakeRow({}))).toBeUndefined();
  });

  it('genera callData para createPropertyPost', () => {
    const data = sheetRowToCallData(
      fakeRow({
        'Call ID': 'call_abc',
        Municipio: 'Felanitx',
        'Tipo de inmueble': 'Nave',
      }),
    );

    expect(data.call_id).toBe('call_abc');
    expect(data.call_analysis.custom_analysis_data.municipio).toBe('Felanitx');
    expect(data.call_analysis.custom_analysis_data.tipo_inmueble).toBe('Nave');
  });

  it('lee Descripción por el propietario', () => {
    const cad = sheetRowToCad(
      fakeRow({
        'Descripción por el propietario':
          'Local luminoso junto al mercado, ideal para hostelería.',
      }),
    );
    expect(cad.descripcion_propietario).toContain('hostelería');
  });
});
