import {
  buildInboundSpanishSummaryOverride,
  INBOUND_SPANISH_SUMMARY_PROMPT,
  interpretRetellHttpResponse,
  retellRequest,
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

  it('un 200 vacío al actualizar el agente no se parsea como JSON', () => {
    expect(
      interpretRetellHttpResponse({
        status: 200,
        rawBody: '',
        requireJsonBody: false,
      }),
    ).toEqual({ ok: true, body: null });
    expect(
      interpretRetellHttpResponse({
        status: 200,
        rawBody: '   ',
        requireJsonBody: true,
      }),
    ).toMatchObject({ ok: false, retry: true });
  });

  it('reintenta si Retell responde vacío al leer el agente y luego acepta el JSON', async () => {
    const calls: string[] = [];
    const fetchImpl = jest.fn(async (_url: string, init?: RequestInit) => {
      calls.push(String(init?.method));
      if (calls.length === 1) {
        return new Response('', {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(
        JSON.stringify({ analysis_summary_prompt: 'ok', is_published: true }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    });

    const body = await retellRequest({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      apiKey: 'test-key',
      method: 'GET',
      path: '/get-agent/agent_1',
      requireJsonBody: true,
      attempts: 3,
      sleep: async () => undefined,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(body).toMatchObject({ is_published: true });
  });

  it('un 200 vacío en publish cuenta como éxito y no reintenta', async () => {
    const fetchImpl = jest.fn(
      async () =>
        new Response('', {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    );

    const body = await retellRequest({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      apiKey: 'test-key',
      method: 'POST',
      path: '/publish-agent/agent_1',
      requireJsonBody: false,
      attempts: 3,
      sleep: async () => undefined,
    });

    expect(body).toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
