import { createIsolatedSheetRow } from '../../sheets/sheet-row-isolation';
import {
  callSaysPropertyUnavailable,
  sheetRowSaysPropertyUnavailable,
  shouldSendFase3FollowupMessage,
} from './property-unavailable';

describe('inmueble no disponible', () => {
  it('la columna H = NO corta el seguimiento aunque la llamada se clasifique como éxito', () => {
    expect(
      callSaysPropertyUnavailable({
        call_analysis: {
          custom_analysis_data: { disponibilidad: 'NO' },
        },
        retell_llm_dynamic_variables: { disponibilidad: 'Disponible' },
      }),
    ).toBe(true);
    expect(
      callSaysPropertyUnavailable({
        call_analysis: {
          custom_analysis_data: { disponibilidad: 'SI' },
        },
      }),
    ).toBe(false);
    expect(
      callSaysPropertyUnavailable({
        collected_dynamic_variables: { disponibilidad: 'no disponible' },
      }),
    ).toBe(true);
  });

  it('lee NO de la cabecera de disponibilidad y no de la operación', () => {
    const headers = ['Operación', 'Modalidad de Traspaso', 'Disponibilidad'];
    const row = createIsolatedSheetRow({
      rowNumber: 4,
      headers,
      values: ['Alquiler', 'Venta negocio', 'NO'],
    });
    expect(sheetRowSaysPropertyUnavailable(row, headers)).toBe(true);

    const available = createIsolatedSheetRow({
      rowNumber: 5,
      headers,
      values: ['Traspaso', 'Venta negocio', 'SI'],
    });
    expect(sheetRowSaysPropertyUnavailable(available, headers)).toBe(false);
  });

  it('no dispara el Content SID si H es NO o hubo rechazo', () => {
    expect(
      shouldSendFase3FollowupMessage({ disponibilidad: 'NO' }),
    ).toBe(false);
    expect(
      shouldSendFase3FollowupMessage({
        disponibilidad: 'SI',
        rejected: true,
      }),
    ).toBe(false);
    expect(
      shouldSendFase3FollowupMessage({ disponibilidad: 'SI' }),
    ).toBe(true);
  });
});
