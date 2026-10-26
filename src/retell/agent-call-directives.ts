/** Directrices compartidas por los tres agentes de voz de Localisto. */

export const CALM_EXIT_DIRECTIVE = `# SALIDA ANTE CONFUSIÓN
Si notas confusión extrema, respuestas incoherentes, o que la persona no entiende de qué va la llamada:
- Aclara una sola vez, con una frase corta y un dato real (tipo de inmueble o zona).
- Si sigue sin entender, acláralo una segunda vez como máximo, con otras palabras.
- Después de esos dos intentos, no hagas más preguntas ni repitas el guion.
- Discúlpate y despídete: "Disculpe, parece que no nos estamos entendiendo. No le entretengo más. Que tenga un buen día."
- Llama a end_call en ese mismo turno para colgar.
También cuelga, sin insistir, si salta un contestador, si pide que no le llamen, o si la conversación se alarga sin avanzar.
`;

export const AGENDAR_LLAMADA_DIRECTIVE = `# AGENDAR LLAMADA
Si pide que le llamemos luego, quiere una demo o una cita con el equipo, usa la función AGENDAR_LLAMADA. No inventes horas.
1. Llama a AGENDAR_LLAMADA con accion "consultar".
2. De la respuesta, ofrece como máximo dos huecos, diciendo la etiqueta. Si no hay huecos, discúlpate y di que el equipo le escribirá.
3. Cuando elija uno, llama a AGENDAR_LLAMADA con accion "reservar" y el inicio_iso exacto de ese hueco. Añade nombre y motivo si los tienes.
4. Solo di que la cita está hecha si la respuesta trae reservada=true. Repite el día y la hora de la etiqueta, despídete y cuelga con end_call.
Si reservada no es true, no confirmes la cita. Ofrece otro hueco de la lista o consulta de nuevo.
`;

export const END_CALL_TOOL_DESCRIPTION =
  'Cuelga cuando se despiden, hay contestador, piden no seguir, o tras dos aclaraciones la persona sigue desorientada o no entiende. Despídete en una frase y llama a esta herramienta en ese turno. No la uses para hacer otra pregunta.';

/** Tope de seguridad. El prompt debe colgar antes; esto evita otra llamada de un cuarto de hora. */
export const MAX_CALL_DURATION_MS = 12 * 60 * 1000;

export const AGENDAR_LLAMADA_TOOL_NAME = 'AGENDAR_LLAMADA';

export function buildAgendarLlamadaTool(args: {
  url: string;
  secret?: string;
}): Record<string, unknown> {
  return {
    type: 'custom',
    name: AGENDAR_LLAMADA_TOOL_NAME,
    description:
      'Consulta huecos reales en el calendario de Localicer y registra una llamada o cita. ' +
      'Primero accion consultar. Después accion reservar con el inicio_iso devuelto. No inventes horas.',
    url: args.url,
    method: 'POST',
    speak_during_execution: true,
    speak_after_execution: true,
    execution_message_type: 'static_text',
    execution_message_description: 'Un momento, miro la agenda.',
    timeout_ms: 15000,
    ...(args.secret
      ? { headers: { 'x-localicer-tool-key': args.secret } }
      : {}),
    parameters: {
      type: 'object',
      properties: {
        accion: {
          type: 'string',
          enum: ['consultar', 'reservar'],
          description:
            'consultar devuelve huecos libres. reservar confirma el hueco elegido.',
        },
        inicio_iso: {
          type: 'string',
          description:
            'Obligatorio al reservar. Copia el inicio_iso exacto que devolvió consultar.',
        },
        nombre: {
          type: 'string',
          description: 'Nombre de la persona, si lo ha dicho.',
        },
        motivo: {
          type: 'string',
          description: 'Motivo breve: seguimiento, demo o visita.',
        },
      },
      required: ['accion'],
    },
  };
}

export function promptWithCallDirectives(prompt: string): string {
  let next = prompt.trimEnd();
  if (!next.includes('# SALIDA ANTE CONFUSIÓN')) {
    next = `${next}\n\n${CALM_EXIT_DIRECTIVE.trim()}`;
  }
  if (!next.includes('# AGENDAR LLAMADA')) {
    next = `${next}\n\n${AGENDAR_LLAMADA_DIRECTIVE.trim()}`;
  }
  return `${next}\n`;
}
