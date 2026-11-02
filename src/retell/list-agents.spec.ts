import { listRetellVoiceAgentsHttp } from './list-agents';

describe('listRetellVoiceAgentsHttp', () => {
  it('usa POST /v2/list-agents y lee items (no un array en la raíz)', async () => {
    const fetchImpl = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toContain('/v2/list-agents');
      expect(init?.method).toBe('POST');
      const body = JSON.parse(String(init?.body || '{}'));
      expect(body.filter_criteria.channel).toEqual({
        type: 'string',
        op: 'eq',
        value: 'voice',
      });
      return new Response(
        JSON.stringify({
          has_more: false,
          items: [
            {
              agent_id: 'agent_1',
              agent_name: 'Localisto Outbound',
              channel: 'voice',
              is_suspended: false,
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    });

    const page = await listRetellVoiceAgentsHttp({
      apiKey: 'test-key',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(page.items).toEqual([
      {
        agent_id: 'agent_1',
        agent_name: 'Localisto Outbound',
        channel: 'voice',
        is_suspended: false,
      },
    ]);
    expect(page.has_more).toBe(false);
  });

  it('no falla si la respuesta llega sin items', async () => {
    const fetchImpl = jest.fn(
      async () =>
        new Response(JSON.stringify({ has_more: false }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    );
    const page = await listRetellVoiceAgentsHttp({
      apiKey: 'test-key',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(page.items).toEqual([]);
  });
});
