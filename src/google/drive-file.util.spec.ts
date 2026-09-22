import {
  assertImageBuffer,
  extractDriveFileIdFromUrl,
  inferImageMimeType,
  isLikelyHtmlBuffer,
  normalizeImageMimeType,
  parseDriveConfirmFromHtml,
} from './drive-file.util';

describe('drive-file.util', () => {
  it('extrae fileId de URLs típicas de Drive', () => {
    expect(
      extractDriveFileIdFromUrl(
        'https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUvWxYz/view?usp=sharing',
      ),
    ).toBe('1AbCdEfGhIjKlMnOpQrStUvWxYz');
    expect(
      extractDriveFileIdFromUrl(
        'https://drive.google.com/open?id=1AbCdEfGhIjKlMnOpQrStUvWxYz',
      ),
    ).toBe('1AbCdEfGhIjKlMnOpQrStUvWxYz');
    expect(
      extractDriveFileIdFromUrl(
        'https://drive.google.com/uc?export=download&id=1AbCdEfGhIjKlMnOpQrStUvWxYz',
      ),
    ).toBe('1AbCdEfGhIjKlMnOpQrStUvWxYz');
    expect(
      extractDriveFileIdFromUrl(
        'https://drive.google.com/drive/folders/1FolderIdOnlyHereXXXX',
      ),
    ).toBeNull();
  });

  it('detecta JPEG/PNG y HTML (página de confirmación)', () => {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(inferImageMimeType(jpeg)).toBe('image/jpeg');
    expect(inferImageMimeType(png)).toBe('image/png');
    expect(isLikelyHtmlBuffer(Buffer.from('<!DOCTYPE html><html>'))).toBe(true);
    expect(assertImageBuffer(jpeg, 'abc')).toBe('image/jpeg');
    expect(() =>
      assertImageBuffer(Buffer.from('<html>virus scan warning</html>'), 'abc'),
    ).toThrow(/HTML/);
  });

  it('parsea token confirm de la página de virus-scan', () => {
    const html =
      '<form><input name="confirm" value="t"><input name="uuid" value="u-1"></form>';
    expect(parseDriveConfirmFromHtml(html)).toEqual({
      confirm: 't',
      uuid: 'u-1',
    });
  });

  it('normaliza image/jpg → image/jpeg', () => {
    expect(normalizeImageMimeType('image/jpg')).toBe('image/jpeg');
    expect(normalizeImageMimeType('image/png; charset=binary')).toBe(
      'image/png',
    );
  });
});
