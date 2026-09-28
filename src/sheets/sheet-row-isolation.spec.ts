import {
  columnLetterToIndex0,
  createIsolatedSheetRow,
  isolatedRowsFromGridPage,
  parseA1RangeRows,
  SHEET_COL_DIRECCION,
  SHEET_COL_PAIS,
  SHEET_COL_URL_IMAGEN,
  sheetReadColumnCount,
} from './sheet-row-isolation';

describe('sheet-row-isolation', () => {
  it('CI es la columna 87 y CX la 102', () => {
    expect(columnLetterToIndex0('CI')).toBe(86);
    expect(columnLetterToIndex0('CX')).toBe(101);
    expect(columnLetterToIndex0(SHEET_COL_PAIS)).toBe(86);
    expect(columnLetterToIndex0(SHEET_COL_DIRECCION)).toBe(101);
  });

  it('P es la columna URL Imagen', () => {
    expect(columnLetterToIndex0('P')).toBe(15);
    expect(columnLetterToIndex0(SHEET_COL_URL_IMAGEN)).toBe(15);
  });

  it('un hueco en medio no desplaza la descripción de la fila siguiente', () => {
    const headers = ['Id', 'Descripción inicial', 'Descripción por el propietario'];
    const rows = isolatedRowsFromGridPage({
      startRowIndex0: 451,
      headers,
      columnCount: sheetReadColumnCount(headers.length),
      rowData: [
        { values: [{ formattedValue: '452' }, { formattedValue: 'Texto de la 452' }] },
        null,
        {
          values: [
            { formattedValue: '454' },
            { formattedValue: 'Texto de la 454, no el de la 452' },
          ],
        },
      ],
    });

    expect(rows.map((r) => r.rowNumber)).toEqual([452, 454]);
    expect(rows[0].get('Descripción inicial')).toBe('Texto de la 452');
    expect(rows[1].get('Descripción inicial')).toBe('Texto de la 454, no el de la 452');
    expect(rows[0].get('Descripción inicial')).not.toBe(rows[1].get('Descripción inicial'));
  });

  it('país y dirección salen solo de CI y CX de esa fila', () => {
    const columnCount = sheetReadColumnCount(2);
    const values = new Array(columnCount).fill('');
    values[columnLetterToIndex0('CI')] = 'España';
    values[columnLetterToIndex0('CX')] = 'Calle El califa, 31, Nueva Andalucía, Marbella';
    values[0] = 'otra cosa';

    const row = createIsolatedSheetRow({
      rowNumber: 452,
      headers: ['Nota', 'Descripción inicial'],
      values,
      columnCount,
    });

    expect(row.getByColumnLetter('CI')).toBe('España');
    expect(row.getByColumnLetter('CX')).toContain('El califa');
    expect(row.rowNumber).toBe(452);
    expect(row.get('Descripción inicial')).toBe('');
  });

  it('dos cabeceras iguales no eligen una columna al azar', () => {
    const row = createIsolatedSheetRow({
      rowNumber: 10,
      headers: ['Nota', 'Nota'],
      values: ['primera', 'segunda'],
    });
    expect(row.get('Nota')).toBe('primera');
    expect(row.toObject().Nota).toBe('primera');
  });

  it('parsea el rango A1 sin compactar', () => {
    expect(parseA1RangeRows("'Localizados'!A1:DG904")).toEqual({
      start: 1,
      end: 904,
    });
    expect(parseA1RangeRows('TrasmutadosOtros!A488')).toEqual({
      start: 488,
      end: 488,
    });
  });
});
