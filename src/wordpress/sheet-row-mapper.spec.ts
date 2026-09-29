import { createIsolatedSheetRow } from '../sheets/sheet-row-isolation';
import {
  readWpPostIdFromSheetRow,
  sheetRowToCad,
  sheetRowToCallData,
} from './sheet-row-mapper';

describe('sheet-row-mapper', () => {
  function fakeRow(values: Record<string, string | undefined>) {
    return { get: (h: string) => values[h] };
  }

  it('mapea columnas del Sheet al CAD de WordPress', () => {
    const cad = sheetRowToCad(
      fakeRow({
        'Tipo de inmueble': 'Local Comercial',
        Municipio: 'Inca',
        'Precio ALQUILER/mes': '1.500 €',
        'Superficie util': '95',
        Contrato: 'Alquiler',
      }),
    );

    expect(cad.tipo_inmueble).toBe('Local Comercial');
    expect(cad.municipio).toBe('Inca');
    expect(cad.precio_alquiler).toBe('1500');
    expect(cad.superficie_util).toBe('95');
    expect(cad.contrato).toBe('Alquiler');
  });

  it('lee ID_WP y alias WP Post ID', () => {
    expect(
      readWpPostIdFromSheetRow(fakeRow({ ID_WP: '4242' })),
    ).toBe(4242);
    expect(
      readWpPostIdFromSheetRow(fakeRow({ 'WP Post ID': '99' })),
    ).toBe(99);
    expect(readWpPostIdFromSheetRow(fakeRow({}))).toBeUndefined();
  });

  it('genera callData para createPropertyPost', () => {
    const data = sheetRowToCallData(
      fakeRow({
        'Call ID': 'call_abc',
        Municipio: 'Felanitx',
        'Tipo de inmueble': 'Nave',
      }),
    );

    expect(data.call_id).toBe('call_abc');
    expect(data.call_analysis.custom_analysis_data.municipio).toBe('Felanitx');
    expect(data.call_analysis.custom_analysis_data.tipo_inmueble).toBe('Nave');
  });

  it('lee Descripción por el propietario', () => {
    const cad = sheetRowToCad(
      fakeRow({
        'Descripción por el propietario':
          'Local luminoso junto al mercado, ideal para hostelería.',
      }),
    );
    expect(cad.descripcion_propietario).toContain('hostelería');
  });

  it('mapea URL imagen y Carpeta Drive (sin Street View)', () => {
    const cad = sheetRowToCad(
      fakeRow({
        'URL imagen':
          'https://drive.google.com/file/d/abc123/view?usp=sharing',
        'Carpeta Drive':
          'https://drive.google.com/drive/folders/folderXYZ999',
        'Vista interior StreetView':
          'https://www.google.com/maps/@39.5,2.6,3a,75y',
        'Publicacion Autorizada?': 'SI',
      }),
    );
    expect(cad.url_imagen).toContain('drive.google.com/file');
    expect(cad.carpeta_drive).toContain('folders/folderXYZ999');
    expect(cad.publicacion_autorizada).toBe('SI');
  });

  it('encuentra fotos Drive aunque el encabezado no coincida exactamente', () => {
    const headers = [
      'Call ID',
      'URL Imagen ',
      'Carpeta Google Drive',
      'Vista interior StreetView',
    ];
    const cad = sheetRowToCad(
      fakeRow({
        'URL Imagen ':
          'https://drive.google.com/file/d/zzz999/view',
        'Carpeta Google Drive':
          'https://drive.google.com/drive/folders/folderAAA',
        'Vista interior StreetView':
          'https://www.google.com/maps/@39.5,2.6,3a,75y',
      }),
      headers,
    );
    expect(cad.url_imagen).toContain('zzz999');
    expect(cad.carpeta_drive).toContain('folderAAA');
    expect(String(cad.url_imagen)).not.toContain('maps');
  });

  it('la imagen principal es la columna P (URL Imagen), aunque haya otro enlace Drive', () => {
    const headers = Array.from({ length: 16 }, () => '');
    headers[0] = 'Fotos';
    headers[15] = 'URL Imagen';
    const values = Array.from({ length: 16 }, () => '');
    values[0] = 'https://drive.google.com/file/d/otraFoto/view';
    values[15] =
      '=HYPERLINK("https://drive.google.com/file/d/principalP/view";"ver")';
    const row = createIsolatedSheetRow({
      rowNumber: 12,
      headers,
      values,
    });

    const cad = sheetRowToCad(row, headers);
    const first = String(cad.url_imagen).split(',')[0];
    expect(first).toContain('principalP');
    expect(String(cad.url_imagen)).toContain('otraFoto');
  });

  it('escanea cualquier celda con URL de Drive (p.ej. columna Fotos)', () => {
    const headers = ['Municipio', 'Fotos', 'Otra'];
    const cad = sheetRowToCad(
      fakeRow({
        Municipio: 'Palma',
        Fotos: '=HYPERLINK("https://drive.google.com/file/d/foto111/view";"ver")',
      }),
      headers,
    );
    expect(cad.url_imagen).toContain('foto111');
  });

  it('país y dirección salen de CI y CX de la fila en curso', () => {
    const cad = sheetRowToCad({
      get: () => 'Afganistán',
      getByColumnLetter: (letter: string) =>
        letter === 'CI'
          ? 'España'
          : letter === 'CX'
            ? 'Avenida Carlota Alessandri, 41, Carihuela, Torremolinos'
            : '',
    });
    expect(cad.pais).toBe('España');
    expect(cad.direccion).toContain('Carlota Alessandri');
  });

  it('lee operación, traspaso, precio filtro, etiqueta, anunciantes y enlaces', () => {
    const cells: Record<string, string> = {
      F: 'Traspaso',
      G: 'Venta negocio',
      DH: '12.000 €',
      DK: 'NEGOCIO Y EQUIPAMIENTO',
      S: '600111222',
      T: 'Ana',
      U: 'WhatsApp',
      V: 'https://www.idealista.com/inmueble/1',
      X: '611222333',
      Y: 'Luis',
      Z: 'Llamada',
      AA: 'https://www.fotocasa.es/2',
      AC: '622333444',
      AD: 'Marta',
    };
    const cad = sheetRowToCad({
      get: () => '',
      getByColumnLetter: (letter: string) => cells[letter] || '',
    });
    expect(cad.contrato).toBe('Traspaso');
    expect(cad.modalidad_traspaso).toBe('Venta negocio');
    expect(cad.precio_filtro_busqueda).toBe('12000');
    expect(cad.etiqueta_precio_antes).toBe('NEGOCIO Y EQUIPAMIENTO');
    expect(cad.notas_anunciante).toContain(
      'Anunciante 1: Ana · 600111222 · WhatsApp',
    );
    expect(cad.notas_anunciante).toContain(
      'Anunciante 2: Luis · 611222333 · Llamada',
    );
    expect(cad.notas_anunciante).toContain('Anunciante 3: Marta · 622333444');
    expect(cad.notas_anunciante).toContain('idealista.com');
    expect(cad.notas_anunciante).toContain('fotocasa.es');
  });

  it('pone Foto-entrada la primera aunque la ruta no sea un enlace de Drive', () => {
    const cad = sheetRowToCad(
      fakeRow({
        'Foto-carteles': 'Localizados_Images/cartel.jpg',
        'Foto-entrada': 'Localizados_Images/image_80.jpg',
        'Foto-interior-1': 'Localizados_Images/interior.jpg',
      }),
      ['Foto-carteles', 'Foto-entrada', 'Foto-interior-1'],
    );
    expect(String(cad.imagenes_locales).split(', ')[0]).toBe(
      'Localizados_Images/image_80.jpg',
    );
    expect(cad.imagenes_locales).toContain('cartel.jpg');
    expect(cad.imagenes_locales).toContain('interior.jpg');
  });
});
