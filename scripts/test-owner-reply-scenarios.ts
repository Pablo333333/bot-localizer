/**
 * Prueba controlada local de los 4 escenarios WhatsApp anunciante (A+B+C).
 * Por defecto OWNER_REPLY_DRY_RUN=true — no escribe Sheets ni cancela colas.
 *
 *   $env:OWNER_REPLY_DRY_RUN="true"
 *   $env:OWNER_REPLY_CLASSIFIER="heuristic"
 *   npx ts-node --transpile-only -r tsconfig-paths/register scripts/test-owner-reply-scenarios.ts
 *
 * Con teléfono de prueba (debe existir en Sheet o BD para ruta anunciante):
 *   npx ts-node ... scripts/test-owner-reply-scenarios.ts --phone=+34615058885
 */
import 'dotenv/config';
import { classifyOwnerReplyHeuristic } from '../src/nurturing/inbound-owner/owner-reply-classifier';

const SCENARIOS = [
  {
    name: 'NO_DISPONIBLE',
    body: 'El local ya está vendido, no está disponible',
  },
  {
    name: 'DISPONIBLE',
    body: 'Sí, el local sigue disponible',
  },
  {
    name: 'NO_INTERESADO',
    body: 'No me interesa publicar con vosotros, gracias',
  },
  {
    name: 'NO_CONTACTAR',
    body: 'No me llaméis ni me escribáis más',
  },
] as const;

function main(): void {
  const phoneArg = process.argv.find((a) => a.startsWith('--phone='));
  const phone = phoneArg?.split('=')[1] || '(sin teléfono — solo clasificador)';

  console.log(
    JSON.stringify(
      {
        mode: 'local_controlled',
        dryRunEnv: process.env.OWNER_REPLY_DRY_RUN ?? '(unset → service default)',
        classifier: process.env.OWNER_REPLY_CLASSIFIER ?? 'heuristic',
        phone,
        note: 'Sin despliegue. El lunes: dry-run con phone real + luego OWNER_REPLY_DRY_RUN=false en staging.',
        scenarios: SCENARIOS.map((s) => {
          const result = classifyOwnerReplyHeuristic(s.body);
          return {
            scenario: s.name,
            body: s.body,
            classified: result.intent,
            ok: result.intent === s.name,
            confidence: result.confidence,
            reason: result.reason,
          };
        }),
      },
      null,
      2,
    ),
  );

  const failed = SCENARIOS.filter(
    (s) => classifyOwnerReplyHeuristic(s.body).intent !== s.name,
  );
  if (failed.length) {
    process.exitCode = 2;
  }
}

main();
