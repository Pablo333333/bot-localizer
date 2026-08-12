import {
  buildEstatePropertyPayload,
  extractImageUrlFromCad,
  resolveOperation,
  resolvePrimaryPrice,
  toWordpressRequestBody,
} from './property-mapper';

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
        url_imagen:
          'https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUvWxYz/view?usp=sharing',
        negocio_anterior: 'Cafetería',
      },
    },
  };

  it('mapea a estate_property con metakeys nativos de WP Residence', () => {
    const payload = buildEstatePropertyPayload(mockCall, {
      status: 'pending',
      featuredMediaId: 99,
    });
    const body = toWordpressRequestBody(payload);

    expect(payload.title).toContain('[ALQUILER]');
    expect(payload.title).toContain('Gran Vía');
    expect(payload.status).toBe('pending');
    expect(payload.featured_media).toBe(99);

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
    });

    expect(String((body.meta as any).property_address)).toContain('Gran Vía');
    expect(String((body.meta as any).property_address)).toContain('Madrid');
    expect(body).not.toHaveProperty('_mapping');
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
    expect(payload.meta.property_label).toBeUndefined();
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
        featured_media: 42,
        meta: expect.objectContaining({
          property_price: expect.any(String),
          property_address: expect.any(String),
        }),
      }),
    );
  });
});
