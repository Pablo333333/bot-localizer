import {
  buildWpResidenceTaxonomies,
  resolveCategorySlug,
  resolveFeatureSlugs,
} from './wpresidence-taxonomies';
import { TONI_TEST_WP_POST_IDS } from './wpresidence.constants';

describe('wpresidence-taxonomies', () => {
  it('usa slugs reales: local / oficina / nave (no locales)', () => {
    expect(resolveCategorySlug('Local Comercial')).toBe('local');
    expect(resolveCategorySlug('Oficina')).toBe('oficina');
    expect(resolveCategorySlug('Nave industrial')).toBe('nave');
  });

  it('mapea operación, ciudad y extras a taxonomías del modelo 33393', () => {
    const tax = buildWpResidenceTaxonomies({
      tipo_inmueble: 'Local Comercial',
      contrato: 'Alquiler',
      precio_alquiler: '1500',
      municipio: 'Torrevieja',
      pueblo_barrio: 'Playa del Cura',
      provincia: 'Alicante',
      estado: 'Reformado',
      disponibilidad: 'Disponible',
      equipamiento: 'Aire acondicionado, mobiliario y alarma',
      terraza_patio: '12',
      escaparates: '2',
      disposicion_diafano: 'A pie de calle',
    });

    expect(tax.property_category).toEqual(['local']);
    expect(tax.property_action_category).toContain('alquiler');
    expect(tax.property_city).toEqual(['torrevieja']);
    expect(tax.property_area).toEqual(['playa-del-cura']);
    expect(tax.property_county_state).toEqual(['alicante']);
    expect(tax.property_features).toEqual(
      expect.arrayContaining([
        'aire-acondicionado',
        'mobiliario',
        'sistema-seguridad-alarma',
        'terraza',
        'grandes-escaparates',
        'a-pie-de-calle-planta-baja',
      ]),
    );
    expect(tax.property_status).toEqual(
      expect.arrayContaining(['reformado', 'disponible-inmediatamente']),
    );
  });

  it('asigna venta y traspaso si hay ambos precios', () => {
    const tax = buildWpResidenceTaxonomies({
      precio_venta: '129000',
      precio_traspaso: '30000',
      contrato: 'Traspaso',
    });
    expect(tax.property_action_category).toEqual(
      expect.arrayContaining(['traspaso', 'venta']),
    );
  });

  it('mapea vado y trastienda a features reales', () => {
    expect(
      resolveFeatureSlugs({ vado: 'SI', almacen_trastienda: '15' }),
    ).toEqual(expect.arrayContaining(['aparcamiento', 'almacen-despacho']));
  });
});

describe('TONI_TEST_WP_POST_IDS', () => {
  it('incluye los 5 inmuebles de prueba', () => {
    expect([...TONI_TEST_WP_POST_IDS].sort()).toEqual(
      [33592, 33595, 33597, 33613, 33616],
    );
  });
});
