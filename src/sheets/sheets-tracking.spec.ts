import {
  a1ForHeader,
  columnIndexToA1,
  filterTrackingFields,
  isTrackingHeader,
} from './sheets-tracking';

describe('sheets-tracking', () => {
  it('convierte índices a letras A1 (E, F, CJ, CO–CU, DG)', () => {
    expect(columnIndexToA1(0)).toBe('A');
    expect(columnIndexToA1(4)).toBe('E');
    expect(columnIndexToA1(5)).toBe('F');
    expect(columnIndexToA1(87)).toBe('CJ');
    expect(columnIndexToA1(92)).toBe('CO');
    expect(columnIndexToA1(93)).toBe('CP');
    expect(columnIndexToA1(98)).toBe('CU');
    expect(columnIndexToA1(110)).toBe('DG');
  });

  it('solo permite cabeceras de tracking del bot', () => {
    expect(isTrackingHeader('Llamado')).toBe(true);
    expect(isTrackingHeader('Call ID')).toBe(true);
    expect(isTrackingHeader('Fecha Llamada')).toBe(true);
    expect(isTrackingHeader('WP Post ID')).toBe(true);
    expect(isTrackingHeader('Municipio')).toBe(false);
    expect(isTrackingHeader('Tipo de inmueble')).toBe(false);
    expect(isTrackingHeader('Nombre contacto2')).toBe(false);
    expect(isTrackingHeader('Precio ALQUILER/mes')).toBe(false);
  });

  it('filtra update masivo: descarta datos de inmueble y vacíos', () => {
    const headers = [
      'Tipo de inmueble',
      'Municipio',
      'Llamado',
      'Call ID',
      'Fecha actualizacion',
      'WP Post ID',
      'Publicado Popalicer?',
    ];

    const filtered = filterTrackingFields(
      {
        Municipio: 'Inca',
        'Tipo de inmueble': 'Local',
        Llamado: 'SI',
        'Call ID': 'call_abc',
        'Fecha actualizacion': '13/08/2026 12:00:00',
        'WP Post ID': 4242,
        'Publicado Popalicer?': '',
        'Nombre contacto2': 'Toni',
      },
      headers,
    );

    expect(filtered).toEqual({
      Llamado: 'SI',
      'Call ID': 'call_abc',
      'Fecha actualizacion': '13/08/2026 12:00:00',
      'WP Post ID': '4242',
    });
    expect(filtered).not.toHaveProperty('Municipio');
    expect(filtered).not.toHaveProperty('Tipo de inmueble');
  });

  it('genera A1 solo para cabeceras existentes', () => {
    const headers = ['A', 'B', 'C', 'D', 'Municipio', 'Llamado'];
    expect(a1ForHeader('Llamado', headers, 12)).toBe('F12');
    expect(a1ForHeader('Municipio', headers, 12)).toBe('E12');
  });
});
