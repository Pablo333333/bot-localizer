import { isInvalidAnalyzedValue } from '../../sheets/sheets-cad-updates';
import {
  buildRetellDynamicVariables,
  type RetellOutboundContext,
} from '../../outbound/retell-dynamic-variables';

type SheetRowLike = { get: (header: string) => unknown };

/**
 * Variables de la fila Localizados para la rellamada.
 * Las claves coinciden con {{variable}} del prompt de seguimiento.
 * Un cero o un relleno no se le dicta al agente.
 */
export function buildFollowupSheetVariables(
  row: SheetRowLike,
  context: RetellOutboundContext = {},
): Record<string, string> {
  const { variables } = buildRetellDynamicVariables(row, context);
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(variables)) {
    out[key] = isInvalidAnalyzedValue(value) ? '' : value;
  }
  return out;
}

function joinParts(parts: Array<string | undefined>): string {
  return parts
    .map((p) => String(p || '').trim())
    .filter(Boolean)
    .join(' ');
}

/**
 * Primera frase de la rellamada, con los datos reales de la fila.
 * Si falta un dato, se omite. No inventa zona ni superficie.
 */
export function buildFollowupOpening(vars: Record<string, string>): string {
  const name = (vars.nombre_interlocutor || vars.nombre_contacto_1 || '').trim();
  const greet = name ? `Hola ${name}` : 'Hola';
  const tipo = (vars.tipo_inmueble || '').trim() || 'inmueble';
  const tipoSpoken =
    tipo === 'inmueble'
      ? tipo
      : tipo.charAt(0).toLowerCase() + tipo.slice(1);
  const street = joinParts([vars.tipo_via, vars.nombre_via, vars.numero_via]);
  const zone = (vars.pueblo_barrio || '').trim();
  const city = (vars.municipio || '').trim();
  const place = [street, zone && zone !== city ? zone : '', city]
    .map((p) => p.trim())
    .filter(Boolean)
    .join(', ');
  const surface = (vars.superficie_total || vars.superficie_util || '').trim();
  const where = place ? ` en ${place}` : '';
  const size = surface ? `, de unos ${surface} metros` : '';

  if (!place && !surface && tipo === 'inmueble') {
    return `${greet}, soy Localisto, de Localicer. Le vuelvo a llamar por el inmueble que tenemos localizado a su nombre. ¿Le pillo en un momento?`;
  }

  return `${greet}, soy Localisto, de Localicer. Le vuelvo a llamar por el ${tipoSpoken}${where}${size}. ¿Le pillo en un momento?`;
}
