import {
  isAcceptedImageCellValue,
  sanitizeSheetImageValue,
} from './sheet-image-cell';

describe('columna Q URL Imagen', () => {
  it('acepta URL de Drive y ruta de imagen', () => {
    expect(
      isAcceptedImageCellValue(
        'https://drive.google.com/file/d/abc123/view',
      ),
    ).toBe(true);
    expect(
      isAcceptedImageCellValue('Localizados_Images/image_80.jpg'),
    ).toBe(true);
    expect(
      sanitizeSheetImageValue(
        '=HYPERLINK("https://drive.google.com/file/d/abc123/view";"ver")',
      ),
    ).toContain('drive.google.com');
  });

  it('rechaza fechas de modificación y timestamps', () => {
    expect(isAcceptedImageCellValue('19/10/2026 18:14:03')).toBe(false);
    expect(isAcceptedImageCellValue('2026-10-19T18:14:03.000Z')).toBe(false);
    expect(isAcceptedImageCellValue('1729360443000')).toBe(false);
    expect(sanitizeSheetImageValue('19/10/2026 18:14:03')).toBe('');
    expect(
      sanitizeSheetImageValue(
        '19/10/2026 18:14:03, https://drive.google.com/file/d/abc123/view',
      ),
    ).toBe('https://drive.google.com/file/d/abc123/view');
  });
});
