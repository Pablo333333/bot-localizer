/**
 * Dry-run controlado del flujo anunciante (resolve → classify → acciones simuladas).
 * NO despliega. Con OWNER_REPLY_DRY_RUN=true no escribe Sheets ni cancela colas.
 *
 *   $env:OWNER_REPLY_DRY_RUN="true"
 *   $env:OWNER_REPLY_CLASSIFIER="heuristic"
 *   npx ts-node --transpile-only -r tsconfig-paths/register scripts/dryrun-owner-reply-webhook.ts --phone=+34615058885
 *
 * Lunes: revisar salida de los 4 escenarios; solo entonces quitar dry-run en staging.
 */
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { OwnerReplyService } from '../src/nurturing/inbound-owner/owner-reply.service';

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

async function main(): Promise<void> {
  const phoneArg = process.argv.find((a) => a.startsWith('--phone='));
  const phone = phoneArg?.split('=')[1];
  if (!phone) {
    console.error('Uso: --phone=+34XXXXXXXXX (anunciante conocido en Sheet/BD)');
    process.exit(2);
  }

  process.env.OWNER_REPLY_DRY_RUN =
    process.env.OWNER_REPLY_DRY_RUN?.trim() || 'true';
  process.env.OWNER_REPLY_CLASSIFIER =
    process.env.OWNER_REPLY_CLASSIFIER?.trim() || 'heuristic';

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });
  try {
    const ownerReply = app.get(OwnerReplyService);
    const resolved = await ownerReply.resolveAdvertiser(phone);
    const results = [];
    for (const s of SCENARIOS) {
      if (!resolved.isAdvertiser) {
        results.push({
          scenario: s.name,
          skipped: true,
          reason: 'not_advertiser',
        });
        continue;
      }
      const out = await ownerReply.handleAdvertiserMessage({
        from: phone.startsWith('whatsapp:') ? phone : `whatsapp:${phone}`,
        body: s.body,
        forceDryRun: true,
      });
      results.push({
        scenario: s.name,
        expected: s.name,
        intent: out.intent,
        ok: out.intent === s.name || (out.ambiguous && s.name !== 'NO_CONTACTAR'),
        dryRun: out.dryRun,
        reply: out.reply,
        actions: out.actions,
        sheetRowNumbers: out.sheetRowNumbers,
        leadIds: out.leadIds,
        ambiguous: out.ambiguous,
      });
    }
    console.log(
      JSON.stringify(
        {
          mode: 'owner_reply_webhook_dryrun',
          phone,
          dryRun: ownerReply.isDryRun(),
          classifier: process.env.OWNER_REPLY_CLASSIFIER,
          resolved: {
            isAdvertiser: resolved.isAdvertiser,
            ambiguous: resolved.ambiguous,
            leadIds: resolved.leadIds,
            sheetRows: resolved.sheetRows,
          },
          scenarios: results,
        },
        null,
        2,
      ),
    );
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
