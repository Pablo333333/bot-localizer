import {
  buildInboundSpanishSummaryOverride,
  INBOUND_SPANISH_SUMMARY_PROMPT,
} from './inbound-summary-language';

describe('inbound summary language', () => {
  it('fuerza el resumen de la llamada inbound en español', () => {
    const body = buildInboundSpanishSummaryOverride();
    const agent = body.call_inbound.agent_override.agent;
    expect(agent.language).toBe('es-ES');
    expect(agent.analysis_summary_prompt).toBe(INBOUND_SPANISH_SUMMARY_PROMPT);
    expect(agent.analysis_summary_prompt.toLowerCase()).toContain('español');
    expect(agent.analysis_summary_prompt.toLowerCase()).toContain('prohibido el inglés');
    expect(agent.post_call_analysis_data[0]).toMatchObject({
      type: 'system-presets',
      name: 'call_summary',
    });
  });
});
