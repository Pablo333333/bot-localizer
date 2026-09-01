import {
  buildWpPublishWritebackFields,
  resolvePublicadoPopalicerWriteValue,
} from './wp-publish-writeback';

describe('wp-publish-writeback', () => {
  it('marca Publicado Popalicer? como SI por defecto', () => {
    expect(resolvePublicadoPopalicerWriteValue()).toBe('SI');
    expect(resolvePublicadoPopalicerWriteValue('si')).toBe('SI');
    expect(resolvePublicadoPopalicerWriteValue('PUBLICADO')).toBe('PUBLICADO');
  });

  it('incluye IDs y Publicado Popalicer? en el write-back', () => {
    expect(buildWpPublishWritebackFields(4242, 'SI')).toEqual({
      ID_WP: 4242,
      'WP Post ID': 4242,
      'Wp Post ID': 4242,
      Referencia: 4242,
      'Referencia / WP Post ID': 4242,
      'Publicado Popalicer?': 'SI',
    });
  });
});
