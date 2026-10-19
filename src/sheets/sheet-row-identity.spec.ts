import { createIsolatedSheetRow } from './sheet-row-isolation';
import {
  findRowByIdentity,
  readSheetRowIdentity,
  resolveRowForCellUpdate,
} from './sheet-row-identity';

describe('fila por ID o URL', () => {
  const headers = ['Call ID', 'URL anuncio', 'Descripción por el propietario'];

  function row(rowNumber: number, callId: string, url: string, text: string) {
    return createIsolatedSheetRow({
      rowNumber,
      headers,
      values: [callId, url, text],
    });
  }

  const rows = [
    row(10, 'call-a', 'https://www.idealista.com/inmueble/1/', 'Texto A'),
    row(11, 'call-b', 'https://www.fotocasa.es/2', 'Texto B'),
  ];

  it('localiza por ID aunque el número de fila ya no sea el de antes', () => {
    const identity = readSheetRowIdentity(rows[0], headers);
    const moved = [rows[1], rows[0]];
    const found = resolveRowForCellUpdate(moved, 10, identity, headers);
    expect(found?.rowNumber).toBe(10);
    expect(found?.get('Descripción por el propietario')).toBe('Texto A');
  });

  it('no usa el número de fila si ese sitio ahora es otra ficha', () => {
    const identity = readSheetRowIdentity(rows[0], headers);
    const sorted = [
      row(10, 'call-b', 'https://www.fotocasa.es/2', 'Texto B'),
      row(25, 'call-a', 'https://idealista.com/inmueble/1', 'Texto A'),
    ];
    const found = findRowByIdentity(sorted, identity, headers);
    expect(found?.rowNumber).toBe(25);
    expect(found?.get('Descripción por el propietario')).toBe('Texto A');
    expect(resolveRowForCellUpdate(sorted, 10, identity, headers)?.rowNumber).toBe(
      25,
    );
  });

  it('si hay ID y no aparece, no escribe en la fila sugerida', () => {
    const identity = { uniqueIds: ['call-z'], propertyUrls: [] };
    expect(resolveRowForCellUpdate(rows, 10, identity, headers)).toBeNull();
  });
});
