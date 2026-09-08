import {
  buildEstatePropertyPayload,
  extractImageUrlFromCad,
  resolveOperation,
  resolvePrimaryPrice,
  toWordpressRequestBody,
} from './property-mapper';
import {
  WPRESTENCE_AGENT_ID,
  WPRESTENCE_AUTHOR_ID,
} from './wpresidence.constants';

describe('property-mapper (Retell → WP Residence)', () => {
  const mockCall = {
    call_id: 'test_call_12345',
    call_analysis: {
      call_successful: true,
      call_summary:
        'Llamada de prueba exitosa. El cliente está interesado en publicar el local en alquiler.',
      custom_analysis_data: {
        tipo_inmueble: 'Local Comercial',
        disponibilidad: 'Disponible',
        estado: 'Buen estado',
        superficie_total: '120',
        superficie_util: '110',
        numero_banios: '2',
        num_plantas: '1',
        tipo_via: 'Calle',
        nombre_via: 'Gran Vía',
        numero_via: '45',
        pueblo_barrio: 'Centro',
        municipio: 'Madrid',
        provincia: 'Madrid',
        precio_alquiler: '1.500',
        precio_venta: '',
        fianza_meses: '2',
        contrato: 'Alquiler',
        certificado_energetico: 'C',
        anio_construccion: '1998',
        escaparates: '3',
        negocio_anterior: 'Cafetería',
        url_imagen:
          'https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUvWxYz/view?usp=sharing',
      },
    },
  };

  it('mapea a estate_property con metakeys nativos, agente y usuario', () => {
    const payload = buildEstatePropertyPayload(mockCall, {
      status: 'pending',
      featuredMediaId: 99,
    });
    const body = toWordpressRequestBody(payload);

    expect(payload.title).toContain('[ALQUILER]');
    expect(payload.title).toContain('Gran Vía');
    expect(payload.status).toBe('pending');
    expect(payload.featured_media).toBe(99);
    expect(payload.author).toBe(WPRESTENCE_AUTHOR_ID);

    expect(body.meta).toMatchObject({
      property_price: '1500',
      property_label: '/mes',
      property_size: '110',
      property_lot_size: '120',
      property_bathrooms: '2',
      property_rooms: '1',
      property_state: 'Madrid',
      property_country: 'Spain',
      property_status: 'Buen estado',
      energy_class: 'C',
      property_year: '1998',
      property_agent: String(WPRESTENCE_AGENT_ID),
      property_user: String(WPRESTENCE_AUTHOR_ID),
      'estado-del-inmueble': 'Buen estado',
      'plantas-del-inmueble': '1',
      'numero-de-escaparates': '3',
      'ultima-actividad': 'Cafetería',
      fianza: '2',
    });

    expect(String((body.meta as any).property_address)).toContain('Gran Vía');
    expect(String((body.meta as any).property_address)).toContain('Madrid');
    expect(body).not.toHaveProperty('_mapping');
    expect(body.author).toBe(1);
    expect(body.localicer_taxonomies).toMatchObject({
      property_category: ['local'],
      property_action_category: ['alquiler'],
      property_city: ['madrid'],
    });
  });

  it('no vuelca la ficha técnica en post_content', () => {
    const payload = buildEstatePropertyPayload(mockCall);
    expect(payload.content).not.toMatch(/Detalles del Inmueble/);
    expect(payload.content).not.toMatch(/<li><strong>Precio/);
    expect(payload.content).toContain('Madrid');
    expect(payload.meta.owner_notes).toContain('test_call_12345');
  });

  it('usa la descripción comercial explícita como Comentario del anunciante', () => {
    const payload = buildEstatePropertyPayload(mockCall, {
      commercialContent:
        '<p>Local luminoso en Gran Vía, perfecto para hostelería.</p>',
    });
    expect(payload.content).toContain('perfecto para hostelería');
    expect(payload.content).not.toMatch(/Detalles del Inmueble/);
  });

  it('resuelve operación venta y precio correspondiente', () => {
    const ventaCall = {
      ...mockCall,
      call_analysis: {
        ...mockCall.call_analysis,
        custom_analysis_data: {
          ...mockCall.call_analysis.custom_analysis_data,
          contrato: 'Venta',
          precio_alquiler: '',
          precio_venta: '250000',
          url_imagen: undefined,
        },
      },
    };

    const cad = ventaCall.call_analysis.custom_analysis_data;
    expect(resolveOperation(cad)).toBe('venta');
    expect(resolvePrimaryPrice(cad, 'venta')).toBe('250000');

    const payload = buildEstatePropertyPayload(ventaCall, { status: 'draft' });
    expect(payload.title).toContain('[VENTA]');
    expect(payload.meta.property_price).toBe('250000');
    expect(payload.taxonomies.property_action_category).toContain('venta');
  });

  it('extrae URL de imagen de Google Drive del CAD', () => {
    const url = extractImageUrlFromCad(
      mockCall.call_analysis.custom_analysis_data,
    );
    expect(url).toContain('drive.google.com');
    expect(url).toContain('1AbCdEfGhIjKlMnOpQrStUvWxYz');
  });

  it('el body final apunta a campos esperados por POST /wp/v2/estate_property', () => {
    const payload = buildEstatePropertyPayload(mockCall, {
      status: 'draft',
      featuredMediaId: 42,
    });
    const body = toWordpressRequestBody(payload);

    expect(body).toEqual(
      expect.objectContaining({
        title: expect.any(String),
        content: expect.any(String),
        status: 'draft',
        author: 1,
        featured_media: 42,
        meta: expect.objectContaining({
          property_price: expect.any(String),
          property_address: expect.any(String),
          property_agent: '28973',
        }),
        localicer_taxonomies: expect.objectContaining({
          property_category: ['local'],
        }),
      }),
    );
  });
});
