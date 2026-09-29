import {
  buildEstatePropertyPayload,
  buildListingTitle,
  buildWpSlug,
  extractImageUrlFromCad,
  isCadPublishable,
  normalizeWpCountry,
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
        pais: 'España',
        direccion: 'Calle Gran Vía, 45, Centro, Madrid',
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
      galleryMediaIds: [99, 100, 101],
    });
    const body = toWordpressRequestBody(payload);

    expect(payload.title.startsWith('Local en')).toBe(true);
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
      property_country: 'España',
      property_address: 'Calle Gran Vía, 45, Centro, Madrid',
      property_status: 'Buen estado',
      energy_class: 'C',
      property_year: '1998',
      property_agent: String(WPRESTENCE_AGENT_ID),
      property_user: String(WPRESTENCE_AUTHOR_ID),
      agent_display_option: 'agent_agency',
      property_images: '99,100,101',
      'estado-del-inmueble': 'Buen estado',
      'plantas-del-inmueble': '1',
      'numero-de-escaparates': '3',
      'ultima-actividad': 'Cafetería',
      fianza: '2',
    });

    expect(String((body.meta as any).property_address)).toBe(
      'Calle Gran Vía, 45, Centro, Madrid',
    );
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

  it('mapea latitud/longitud a meta del mapa WPResidence', () => {
    const withGeo = {
      ...mockCall,
      call_analysis: {
        ...mockCall.call_analysis,
        custom_analysis_data: {
          ...mockCall.call_analysis.custom_analysis_data,
          latitud: '39,5696',
          longitud: '2,6502',
          codigo_postal: '07001',
        },
      },
    };
    const payload = buildEstatePropertyPayload(withGeo);
    expect(payload.meta.property_latitude).toBe('39.5696');
    expect(payload.meta.property_longitude).toBe('2.6502');
    expect(payload.meta.property_zip).toBe('07001');
    expect(payload.meta.property_google_view).toBe('1');
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
    expect(body.slug).toBe(payload.slug);
  });

  it('alinea título y slug con los anuncios de referencia', () => {
    const restaurante = buildListingTitle(
      {
        negocio_anterior: 'Restaurante',
        tipo_inmueble: 'Local',
        tipo_via: 'Calle',
        nombre_via: 'El califa',
        numero_via: '31',
        pueblo_barrio: 'Nueva Andalucía',
        municipio: 'Marbella',
        provincia: 'Málaga',
        superficie_total: '126',
        contrato: 'Traspaso',
      },
      'traspaso',
    );
    expect(restaurante).toBe(
      'Restaurante en Calle El califa, 31, Nueva Andalucía, Marbella (MÁLAGA) – [TRASPASO] – 126 m2',
    );
    expect(buildWpSlug(restaurante)).toBe(
      'restaurante-en-calle-el-califa-31-nueva-andalucia-marbella-malaga-traspaso-126-m2',
    );

    const nave = buildListingTitle(
      {
        tipo_inmueble: 'Nave',
        tipo_via: 'Camino',
        nombre_via: 'De Mollina',
        numero_via: 's/n',
        pueblo_barrio: 'centro-ciudad',
        municipio: 'Alameda',
        provincia: 'Málaga',
        superficie_total: '4900',
        contrato: 'Venta',
      },
      'venta',
    );
    expect(nave).toBe(
      'Nave en Camino De Mollina s/n, Alameda (MÁLAGA) – [VENTA] – 4900 m2',
    );
    expect(buildWpSlug(nave)).toBe(
      'nave-en-camino-de-mollina-s-n-alameda-malaga-venta-4900-m2',
    );

    const local = buildListingTitle(
      {
        tipo_inmueble: 'Local',
        negocio_anterior: 'Almacén',
        tipo_via: 'Calle',
        nombre_via: 'Albaicín',
        numero_via: '1',
        municipio: 'Teba',
        provincia: 'Málaga',
        superficie_total: '95',
        contrato: 'Alquiler',
      },
      'alquiler',
    );
    expect(buildWpSlug(local)).toBe(
      'local-en-calle-albaicin-1-teba-malaga-alquiler-95-m2',
    );
  });

  it('el país sale de la columna de la fila y Spain no se publica como Afghanistan', () => {
    expect(normalizeWpCountry('Spain')).toBe('España');
    expect(normalizeWpCountry('España')).toBe('España');
    const payload = buildEstatePropertyPayload({
      call_analysis: { custom_analysis_data: { pais: 'España', direccion: 'Calle Alta, 104' } },
    });
    expect(payload.meta.property_country).toBe('España');
    expect(payload.meta.property_address).toBe('Calle Alta, 104');

    const empty = buildEstatePropertyPayload({
      call_analysis: { custom_analysis_data: { municipio: 'Marbella' } },
    });
    expect(empty.meta.property_country).toBeUndefined();
    expect(empty.meta.property_address).toBeUndefined();
  });

  it('venta o alquiler empieza por el tipo y lista las dos operaciones', () => {
    const title = buildListingTitle({
      tipo_inmueble: 'Local',
      negocio_anterior: 'Peluquería',
      tipo_via: 'Calle',
      nombre_via: 'Ciudad de Salamanca',
      numero_via: '38',
      pueblo_barrio: 'Zona de la Quinta',
      municipio: 'Antequera',
      provincia: 'Málaga',
      superficie_total: '100',
      contrato: 'Venta, Alquiler',
    });
    expect(title).toBe(
      'Local en Calle Ciudad de Salamanca, 38, Zona de la Quinta, Antequera (MÁLAGA) – [VENTA, ALQUILER] – 100 m2',
    );
  });

  it('prioriza venta para el buscador y deja el alquiler delante de la etiqueta', () => {
    const payload = buildEstatePropertyPayload({
      call_id: 'call_x',
      call_analysis: {
        custom_analysis_data: {
          contrato: 'Venta, Alquiler',
          precio_venta: '180000',
          precio_alquiler: '800',
          notas_anunciante: 'Anunciante 1: Ana · 600111222 | Enlace: https://idealista.com/1',
        },
      },
    });
    expect(payload.meta.property_price).toBe('180000');
    expect(payload.meta.property_label).toBeUndefined();
    expect(payload.meta.property_label_before).toBe('Alquiler 800 €/mes');
    expect(payload.meta.owner_notes).toContain('Ana');
    expect(payload.meta.owner_notes).toContain('idealista.com');
    expect(payload.meta.owner_notes).toContain('call_x');
  });

  it('DH fija el precio, DK la etiqueta y el traspaso lleva la actividad', () => {
    const payload = buildEstatePropertyPayload({
      call_analysis: {
        custom_analysis_data: {
          contrato: 'Traspaso',
          precio_traspaso: '12000',
          precio_filtro_busqueda: '9000',
          etiqueta_precio_antes: 'NEGOCIO Y EQUIPAMIENTO',
          modalidad_traspaso: 'Venta negocio',
          negocio_anterior: 'Peluquería',
          tipo_inmueble: 'Local',
          tipo_via: 'Calle',
          nombre_via: 'Mayor',
          municipio: 'Antequera',
        },
      },
    });
    expect(payload.meta.property_price).toBe('9000');
    expect(payload.meta.property_label_before).toBe('NEGOCIO Y EQUIPAMIENTO');
    expect(payload.meta['traspaso']).toBe('Venta negocio');
    expect(payload.title.startsWith('Peluquería en')).toBe(true);
    expect(payload.title).toContain('[TRASPASO]');
  });

  it('publica si la operación es venta aunque disponibilidad ya no diga SI', () => {
    expect(isCadPublishable({ contrato: 'Venta', precio_venta: '1000' })).toBe(true);
    expect(isCadPublishable({ disponibilidad: 'SI' })).toBe(true);
    expect(isCadPublishable({ disponibilidad: 'NO' })).toBe(false);
    expect(isCadPublishable({})).toBe(false);
  });
});
