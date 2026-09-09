import {
  extractDriveFolderId,
  extractDriveFileId,
  extractDriveFolderIdFromCad,
  extractImageUrlsFromCad,
  formatPropertyImagesMeta,
} from './property-media-sources';

describe('property-media-sources', () => {
  it('parsea URL de archivo Drive', () => {
    expect(
      extractDriveFileId(
        'https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUvWxYz/view?usp=sharing',
      ),
    ).toBe('1AbCdEfGhIjKlMnOpQrStUvWxYz');
    expect(
      extractDriveFileId(
        'https://drive.google.com/drive/folders/1FolderIdOnlyHereXXXX',
      ),
    ).toBeNull();
  });

  it('parsea URL de carpeta Drive', () => {
    expect(
      extractDriveFolderId(
        'https://drive.google.com/drive/folders/1FolderIdOnlyHereXXXX',
      ),
    ).toBe('1FolderIdOnlyHereXXXX');
    expect(extractDriveFolderId('1FolderIdOnlyHereXXXXXX')).toBe(
      '1FolderIdOnlyHereXXXXXX',
    );
  });

  it('extrae varias URLs del CAD y omite Street View', () => {
    const urls = extractImageUrlsFromCad({
      url_imagen:
        'https://drive.google.com/file/d/aaa111/view, https://drive.google.com/file/d/bbb222/view',
      imagen_url: 'https://www.google.com/maps/@39.5,2.6,3a,75y',
    });
    expect(urls).toEqual([
      'https://drive.google.com/file/d/aaa111/view',
      'https://drive.google.com/file/d/bbb222/view',
    ]);
  });

  it('lee carpeta Drive del CAD y también desde URL imagen tipo /folders/', () => {
    expect(
      extractDriveFolderIdFromCad({
        carpeta_drive:
          'https://drive.google.com/drive/folders/1PropFolderABCDEFG',
      }),
    ).toBe('1PropFolderABCDEFG');
    expect(
      extractDriveFolderIdFromCad({
        url_imagen:
          'https://drive.google.com/drive/folders/1FromUrlImagenFolder',
      }),
    ).toBe('1FromUrlImagenFolder');
  });

  it('formatea meta property_images', () => {
    expect(formatPropertyImagesMeta([10, 20, 30])).toBe('10,20,30');
    expect(formatPropertyImagesMeta([])).toBe('');
  });
});
