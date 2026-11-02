import type Retell from 'retell-sdk';
import { RETELL_API_BASE, retellRequest } from './inbound-summary-language';

/**
 * Listado de agentes de voz (POST /v2/list-agents).
 * El endpoint legacy GET /list-agents ya no existe.
 * La respuesta es paginada: los agentes van en `items`, no en la raíz.
 */

export type RetellVoiceAgentSummary = {
  agent_id: string;
  agent_name: string;
  channel: 'voice' | 'chat';
  is_suspended: boolean;
};

export type ListRetellAgentsPage = {
  items: RetellVoiceAgentSummary[];
  has_more: boolean;
  pagination_key?: string;
};

const VOICE_CHANNEL_FILTER = {
  channel: {
    type: 'string' as const,
    op: 'eq' as const,
    value: 'voice' as const,
  },
};

/** Preferido: SDK ≥ 6.2 (POST /v2/list-agents + `items`). */
export async function listRetellVoiceAgents(
  client: Retell,
  options?: { limit?: number; paginationKey?: string },
): Promise<ListRetellAgentsPage> {
  const page = await client.agent.list({
    limit: options?.limit,
    pagination_key: options?.paginationKey,
    filter_criteria: VOICE_CHANNEL_FILTER,
  });
  return {
    items: (page.items || []).map((agent) => ({
      agent_id: agent.agent_id,
      agent_name: agent.agent_name,
      channel: agent.channel,
      is_suspended: agent.is_suspended,
    })),
    has_more: page.has_more === true,
    pagination_key: page.pagination_key,
  };
}

/**
 * Misma API sin SDK: POST https://api.retellai.com/v2/list-agents
 * y lectura de `body.items` (nunca un array en la raíz).
 */
export async function listRetellVoiceAgentsHttp(args: {
  apiKey: string;
  limit?: number;
  paginationKey?: string;
  fetchImpl?: typeof fetch;
}): Promise<ListRetellAgentsPage> {
  const limit = args.limit ?? 50;
  const query = new URLSearchParams({ limit: String(limit) });
  if (args.paginationKey) query.set('pagination_key', args.paginationKey);

  const body = await retellRequest({
    fetchImpl: args.fetchImpl ?? fetch,
    apiKey: args.apiKey,
    method: 'POST',
    path: `/v2/list-agents?${query.toString()}`,
    jsonBody: { filter_criteria: VOICE_CHANNEL_FILTER },
    requireJsonBody: true,
  });

  const itemsRaw = Array.isArray(body?.items) ? body.items : [];
  const items: RetellVoiceAgentSummary[] = [];
  for (const row of itemsRaw) {
    if (!row || typeof row !== 'object') continue;
    const record = row as Record<string, unknown>;
    const agentId = String(record.agent_id ?? '');
    if (!agentId) continue;
    items.push({
      agent_id: agentId,
      agent_name: String(record.agent_name ?? ''),
      channel: record.channel === 'chat' ? 'chat' : 'voice',
      is_suspended: record.is_suspended === true,
    });
  }

  return {
    items,
    has_more: body?.has_more === true,
    pagination_key:
      typeof body?.pagination_key === 'string' ? body.pagination_key : undefined,
  };
}

/** URL canónica del endpoint (documentación / auditoría). */
export const RETELL_LIST_AGENTS_URL = `${RETELL_API_BASE}/v2/list-agents`;
