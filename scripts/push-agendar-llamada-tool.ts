/**
 * Publica AGENDAR_LLAMADA, la salida ante confusión y el tope de duración
 * en los tres agentes de voz. No borra el resto de herramientas.
 *
 *   npx ts-node --transpile-only -r tsconfig-paths/register scripts/push-agendar-llamada-tool.ts
 */
import 'dotenv/config';
import Retell from 'retell-sdk';
import {
  AGENDAR_LLAMADA_TOOL_NAME,
  buildAgendarLlamadaTool,
  END_CALL_TOOL_DESCRIPTION,
  MAX_CALL_DURATION_MS,
  promptWithCallDirectives,
} from '../src/retell/agent-call-directives';

const AGENTS = [
  {
    label: 'Localisto Outbound',
    id: process.env.RETELL_OUTBOUND_AGENT_ID || 'agent_b8abf941c156192b1995f36c5d',
  },
  {
    label: 'Localisto Outbound (Rellamada)',
    id:
      process.env.RETELL_AGENT_ID_FOLLOWUP || 'agent_25c341a3bcc06e505b5ed2850c',
  },
  {
    label: 'Localisto Inbound',
    id: /x{4,}/i.test(process.env.RETELL_INBOUND_AGENT_ID || '')
      ? 'agent_0f4976dcf81fabf8d95fce33e1'
      : process.env.RETELL_INBOUND_AGENT_ID || 'agent_0f4976dcf81fabf8d95fce33e1',
  },
];

function toolUrl(): string {
  const base = (
    process.env.PUBLIC_BASE_URL || 'https://bot-localicer-production.up.railway.app'
  ).replace(/\/$/, '');
  return `${base}/webhooks/retell/agendar-llamada`;
}

async function main(): Promise<void> {
  const client = new Retell({ apiKey: process.env.RETELL_API_KEY || '' });
  const url = toolUrl();
  const secret = process.env.RETELL_TOOL_SECRET?.trim() || '';
  const tool = buildAgendarLlamadaTool({ url, secret: secret || undefined });

  for (const agent of AGENTS) {
    const current = await client.agent.retrieve(agent.id);
    const engine = current.response_engine as { type?: string; llm_id?: string };
    if (engine.type !== 'retell-llm' || !engine.llm_id) {
      throw new Error(
        `${agent.label} no usa retell-llm (${engine.type || 'sin motor'})`,
      );
    }

    const llm = await client.llm.retrieve(engine.llm_id);
    const tools = [...(llm.general_tools || [])].filter(
      (item) => item.name !== AGENDAR_LLAMADA_TOOL_NAME,
    );
    const endCall = tools.find((item) => item.type === 'end_call');
    if (endCall) {
      endCall.description = END_CALL_TOOL_DESCRIPTION;
    } else {
      tools.unshift({
        type: 'end_call',
        name: 'end_call',
        description: END_CALL_TOOL_DESCRIPTION,
      });
    }
    tools.push(tool as (typeof tools)[number]);

    const prompt = promptWithCallDirectives(llm.general_prompt || '');
    await client.llm.update(engine.llm_id, {
      general_prompt: prompt,
      general_tools: tools,
    });
    await client.agent.update(agent.id, {
      max_call_duration_ms: MAX_CALL_DURATION_MS,
    });
    const updated = await client.agent.retrieve(agent.id);
    const publish = await fetch(
      `https://api.retellai.com/publish-agent-version/${encodeURIComponent(agent.id)}`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.RETELL_API_KEY || ''}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ version: updated.version }),
      },
    );
    if (!publish.ok) {
      throw new Error(
        `publish ${agent.label} HTTP ${publish.status}: ${(await publish.text()).slice(0, 240)}`,
      );
    }

    console.log(
      `${agent.label} publicado. llm=${engine.llm_id} tools=${tools.map((item) => item.name).join(',')} prompt_chars=${prompt.length} max_ms=${MAX_CALL_DURATION_MS}`,
    );
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
