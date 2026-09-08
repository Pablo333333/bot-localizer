/**
 * Mock local: simula un registro Retell completo y verifica el payload
 * que se enviaría a POST /wp/v2/estate_property (sin llamar a WordPress).
 *
 * Uso: npx ts-node test-wp-property-payload.ts
 */
import {
  buildEstatePropertyPayload,
  extractImageUrlFromCad,
  toWordpressRequestBody,
} from './src/wordpress/property-mapper';

const mockRetellCall = {
  event_type: 'call_analyzed',
  call_id: 'mock_call_wp_residence_001',
  agent_id: 'agent_b8abf941c156192b1995f36c5d',
  from_number: '+34600112233',
  to_number: '+34622334455',
  call_analysis: {
    call_successful: true,
    call_summary:
      'El propietario confirma local disponible en alquiler en Gran Vía, autoriza publicación.',
    custom_analysis_data: {
      target_contact: 'contacto_2',
      tipo_inmueble: 'Local Comercial',
      disponibilidad: 'Disponible',
      estado: 'Buen estado',
      superficie_total: '120',
      superficie_util: '110',
      negocio_anterior: 'Cafetería',
      numero_banios: '2',
      num_plantas: '1',
      tipo_via: 'Calle',
      nombre_via: 'Gran Vía',
      numero_via: '45',
      pueblo_barrio: 'Centro',
      municipio: 'Madrid',
      provincia: 'Madrid',
      precio_alquiler: '1500',
      fianza_meses: '2',
      es_negociable: 'SI',
      contrato: 'Alquiler',
      certificado_energetico: 'C',
      anio_construccion: '1998',
      url_imagen:
        'https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUvWxYz/view?usp=sharing',
      publicacion_autorizada: 'SI',
      nombre_contacto_2: 'Carlos Gómez (Test)',
      email_propietario_gestor: 'carlos.test@example.com',
    },
  },
};

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`ASSERT FAIL: ${message}`);
  }
}

function main() {
  const status = process.env.WP_POST_STATUS || 'pending';
  const featuredMediaId = 4242; // simula media ya subido a /wp/v2/media

  const payload = buildEstatePropertyPayload(mockRetellCall, {
    status,
    featuredMediaId,
  });
  const body = toWordpressRequestBody(payload);
  const imageUrl = extractImageUrlFromCad(
    mockRetellCall.call_analysis.custom_analysis_data,
  );

  const preview = {
    method: 'POST',
    endpoint: '/wp-json/wp/v2/estate_property',
    post_type: 'estate_property',
    body,
    derived: {
      imageUrlFromCad: imageUrl,
      operation: payload._mapping?.operation,
      categorySlug: payload._mapping?.categorySlug,
      featured_media: featuredMediaId,
    },
  };

  console.log('=== Mock Retell → WP Residence payload ===\n');
  console.log(JSON.stringify(preview, null, 2));

  assert(
    typeof body.title === 'string' && String(body.title).includes('[ALQUILER]'),
    'title debe incluir [ALQUILER]',
  );
  assert(body.status === status, `status debe ser ${status}`);
  assert(body.featured_media === featuredMediaId, 'featured_media asignado');
  assert(
    (body.meta as any)?.property_price === '1500',
    'property_price mapeado',
  );
  assert(
    (body.meta as any)?.property_label === '/mes',
    'property_label /mes para alquiler',
  );
  assert(
    (body.meta as any)?.property_size === '110',
    'property_size = superficie útil',
  );
  assert(
    String((body.meta as any)?.property_address || '').includes('Gran Vía'),
    'property_address incluye vía',
  );
  assert(!!imageUrl && imageUrl.includes('drive.google.com'), 'URL Drive en CAD');
  assert(!(body as any)._mapping, 'sin _mapping en body');
  assert((body as any).author === 1, 'author = usuario 1');
  assert(
    (body.meta as any)?.property_agent === '28973',
    'property_agent = 28973',
  );
  assert(
    !String(body.content).includes('Detalles del Inmueble'),
    'content no es ficha técnica',
  );
  assert(
    (body as any).localicer_taxonomies?.property_category?.[0] === 'local',
    'taxonomía property_category = local',
  );

  console.log('\n✓ Payload válido para estate_property + meta WP Residence');
}

main();
