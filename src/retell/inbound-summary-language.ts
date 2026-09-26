/**
 * El agente outbound ya resume en español. El inbound usa el prompt por defecto
 * (inglés) salvo que, al entrar la llamada, le forcemos el análisis en español.
 * Retell aplica este override al generar call_summary cuando la llamada termina.
 */

export const INBOUND_SPANISH_SUMMARY_PROMPT =
  'Redacta call_summary ÚNICAMENTE en español de España. ' +
  'Prohibido el inglés y cualquier otro idioma, aunque la llamada haya tenido palabras sueltas en inglés. ' +
  'En 2 a 4 frases: quién llamó, qué inmueble o consulta trató, el resultado y el siguiente paso si lo hubo. ' +
  'Si no hubo conversación útil, dilo en español.';

export function buildInboundSpanishSummaryOverride(): {
  call_inbound: {
    agent_override: {
      agent: {
        language: 'es-ES';
        analysis_summary_prompt: string;
        post_call_analysis_data: Array<{
          type: 'system-presets';
          name: 'call_summary';
          description: string;
        }>;
      };
    };
  };
} {
  return {
    call_inbound: {
      agent_override: {
        agent: {
          language: 'es-ES',
          analysis_summary_prompt: INBOUND_SPANISH_SUMMARY_PROMPT,
          post_call_analysis_data: [
            {
              type: 'system-presets',
              name: 'call_summary',
              description: INBOUND_SPANISH_SUMMARY_PROMPT,
            },
          ],
        },
      },
    },
  };
}
