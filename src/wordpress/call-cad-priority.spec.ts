import { preferCallCad } from './call-cad-priority';

describe('preferCallCad', () => {
  it('el dato no vacío de la llamada sustituye al del Sheet', () => {
    const merged = preferCallCad(
      {
        precio_alquiler: '1500',
        superficie_util: '110',
        numero_banios: '1',
        escaparates: '1',
        municipio: 'Inca',
      },
      {
        precio_alquiler: '1800',
        superficie_util: '',
        numero_banios: '2',
        escaparates: '3',
        municipio: 'no especificado',
      },
    );

    expect(merged.precio_alquiler).toBe('1800');
    expect(merged.superficie_util).toBe('110');
    expect(merged.numero_banios).toBe('2');
    expect(merged.escaparates).toBe('3');
    expect(merged.municipio).toBe('Inca');
  });

  it('no borra el original si la llamada no aporta el campo', () => {
    const merged = preferCallCad(
      { precio_venta: '250000', extras: 'Aire acondicionado' },
      { precio_alquiler: '900' },
    );
    expect(merged.precio_venta).toBe('250000');
    expect(merged.extras).toBe('Aire acondicionado');
    expect(merged.precio_alquiler).toBe('900');
  });

  it('un cero de la llamada no sustituye el precio ni los gastos del Sheet', () => {
    const merged = preferCallCad(
      {
        precio_alquiler: '900',
        gastos_comunidad: '45',
        precio_venta: '125000',
        contacto_2_con: 'Particular',
      },
      {
        precio_alquiler: 0,
        gastos_comunidad: '0',
        precio_venta: '100000',
        contacto_2_con: 'Indeterminado',
        estado: 'interesado_ia',
        oportunidad_comercial: 'NINGUNA',
      },
    );

    expect(merged.precio_alquiler).toBe('900');
    expect(merged.gastos_comunidad).toBe('45');
    expect(merged.precio_venta).toBe('100000');
    expect(merged.contacto_2_con).toBe('Particular');
    expect(merged.estado).toBeUndefined();
    expect(merged.oportunidad_comercial).toBeUndefined();
  });
});
