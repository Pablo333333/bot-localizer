/**
 * Publica el prompt de rellamada en el LLM de Retell (no borra herramientas).
 *   npx ts-node -r tsconfig-paths/register scripts/push-followup-agent-prompt.ts
 */
import 'dotenv/config';
import Retell from 'retell-sdk';
import {
  FOLLOWUP_AGENT_GENERAL_PROMPT,
  FOLLOWUP_AGENT_LLM_ID,
} from '../src/nurturing/channels/followup-agent-prompt';

async function main(): Promise<void> {
  const client = new Retell({ apiKey: process.env.RETELL_API_KEY || '' });
  const updated = await client.llm.update(FOLLOWUP_AGENT_LLM_ID, {
    general_prompt: FOLLOWUP_AGENT_GENERAL_PROMPT,
    begin_message: '',
  });
  const prompt = updated.general_prompt || '';
  console.log(
    `LLM ${FOLLOWUP_AGENT_LLM_ID} actualizado. prompt_chars=${prompt.length} menciona_direccion=${prompt.includes('{{nombre_via}}')}`,
  );
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
