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
});
