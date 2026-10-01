/**
 * Añade al agente de prospección la regla de decir el precio como cantidad.
 * No toca herramientas ni el resto del prompt.
 *   npx ts-node -r tsconfig-paths/register scripts/patch-outbound-price-speech.ts
 */
import 'dotenv/config';
import Retell from 'retell-sdk';

const OUTBOUND_LLM_ID = 'llm_67368465cc791f69278524169c23';

const BLOCK = `# CÓMO DECIR EL PRECIO
Los precios llegan ya en palabras, por ejemplo "cien mil euros" o "mil ochocientos euros".
Dilos tal cual, como una cantidad. Nunca cifra a cifra.
Si ves 100000, di "cien mil euros", no "uno cero cero cero cero cero".
No escribas el precio en cifras. El alquiler se dice "al mes".

`;

async function main(): Promise<void> {
  const client = new Retell({ apiKey: process.env.RETELL_API_KEY || '' });
  const llm = await client.llm.retrieve(OUTBOUND_LLM_ID);
  let prompt = llm.general_prompt || '';
  if (!prompt.includes('# CÓMO DECIR EL PRECIO')) {
    const anchor = '# REGLAS CLAVE';
    if (!prompt.includes(anchor)) {
      throw new Error('No está el ancla # REGLAS CLAVE');
    }
    prompt = prompt.replace(anchor, BLOCK + anchor);
  }
  const updated = await client.llm.update(OUTBOUND_LLM_ID, {
    general_prompt: prompt,
  });
  const out = updated.general_prompt || '';
  console.log(
    `LLM ${OUTBOUND_LLM_ID} actualizado. prompt_chars=${out.length} cifra_a_cifra=${out.includes('Nunca cifra a cifra')}`,
  );
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
