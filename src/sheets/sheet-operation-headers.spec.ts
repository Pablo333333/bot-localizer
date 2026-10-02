import {
  findOperacionHeader,
  findTraspasoModalidadHeader,
  formatOperationCell,
  parseTraspasoModalidad,
} from './sheet-operation-headers';

describe('cabeceras Operación y modalidad de traspaso', () => {
  const headers = [
    'Tipo de inmueble',
    'Operación',
    'Modalidad de Traspaso',
    'Precio TRASPASO',
    'Contrato',
  ];

  it('localiza Operación antes que Contrato y no confunde el precio', () => {
    expect(findOperacionHeader(headers)).toBe('Operación');
    expect(findTraspasoModalidadHeader(headers)).toBe('Modalidad de Traspaso');
    expect(findOperacionHeader(['Contrato', 'Precio VENTA'])).toBe('Contrato');
    expect(findTraspasoModalidadHeader(['Precio TRASPASO'])).toBeNull();
  });

  it('normaliza acentos y acepta Modalidad Traspaso', () => {
    expect(findOperacionHeader(['OPERACION'])).toBe('OPERACION');
    expect(findTraspasoModalidadHeader(['Modalidad Traspaso'])).toBe(
      'Modalidad Traspaso',
    );
  });

  it('solo escribe Alquiler, Venta o Traspaso, y las dos modalidades', () => {
    expect(formatOperationCell('alquiler y venta')).toBe('Venta, Alquiler');
    expect(formatOperationCell('Disponible')).toBe('');
    expect(formatOperationCell('SI')).toBe('');
    expect(parseTraspasoModalidad('venta con inmueble')).toBe(
      'Venta con inmueble',
    );
    expect(parseTraspasoModalidad('Venta negocio')).toBe('Venta negocio');
    expect(parseTraspasoModalidad('Traspaso')).toBe('');
  });
});
