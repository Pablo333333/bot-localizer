import {
  mediaNameKey,
  pickReusableMediaId,
  sanitizeWpMediaFileName,
  sha256Buffer,
} from './property-media-dedup';

describe('property-media-dedup', () => {
  const foto = Buffer.from('foto-local-entrada');
  const hash = sha256Buffer(foto);

  it('normaliza el nombre y trata el sufijo -2 de WordPress como el mismo archivo', () => {
    expect(sanitizeWpMediaFileName('Foto Entrada.JPG', 'image/jpeg')).toBe(
      'Foto_Entrada.JPG',
    );
    expect(mediaNameKey('https://localicer.com/wp-content/uploads/2026/10/Foto_Entrada-2.jpg')).toBe(
      mediaNameKey('Foto Entrada.jpg'),
    );
  });

  it('reutiliza el adjunto del post si el nombre coincide', () => {
    const id = pickReusableMediaId(
      [
        { id: 9, file: '2026/10/otra.jpg', parent: 3, filesize: 10 },
        { id: 15, file: '2026/10/Foto_Entrada.jpg', parent: 42, filesize: foto.length },
      ],
      { fileName: 'Foto Entrada.jpg', byteLength: foto.length, contentHash: hash, postId: 42 },
    );
    expect(id).toBe(15);
  });

  it('reutiliza por hash aunque el nombre no coincida', () => {
    const hashes = new Map<number, string>([[7, hash]]);
    const id = pickReusableMediaId(
      [{ id: 7, file: '2026/10/drive_abc.jpg', filesize: foto.length }],
      {
        fileName: 'fachada.png',
        byteLength: foto.length,
        contentHash: hash,
        hashes,
      },
    );
    expect(id).toBe(7);
  });

  it('no reutiliza un archivo con el mismo nombre y otro hash', () => {
    const hashes = new Map<number, string>([[4, 'otro-hash']]);
    const id = pickReusableMediaId(
      [{ id: 4, file: 'Foto_Entrada.jpg', filesize: foto.length }],
      {
        fileName: 'Foto Entrada.jpg',
        byteLength: foto.length,
        contentHash: hash,
        hashes,
      },
    );
    expect(id).toBeNull();
  });
});
