import {
  COL_PROPIETARIO_CONTACTADO,
  WP_PUBLISH_CONTACTED_VALUE,
  buildWpPublishWritebackFields,
} from './wp-publish-writeback';

describe('wp-publish-writeback', () => {
  it('marca Propietario contactado? como SI y no toca Publicado Popalicer?', () => {
    expect(buildWpPublishWritebackFields(4242)).toEqual({
      ID_WP: 4242,
      'WP Post ID': 4242,
      'Wp Post ID': 4242,
      Referencia: 4242,
      'Referencia / WP Post ID': 4242,
      [COL_PROPIETARIO_CONTACTADO]: WP_PUBLISH_CONTACTED_VALUE,
    });
    expect(JSON.stringify(buildWpPublishWritebackFields(4242))).not.toMatch(
      /Publicado Popalicer/i,
    );
  });
});
