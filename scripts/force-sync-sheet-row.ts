/**
 * Publica una fila concreta de Localizados en WordPress, saltando
 * sandbox, el gate "Publicación Autorizada?" y bloqueos temporales.
 *
 * Uso (desde bot-server, con .env y google-credentials.json):
 *   npx ts-node -r tsconfig-paths/register scripts/force-sync-sheet-row.ts 618
 */
import 'dotenv/config';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { SheetsReviewedSyncService } from '../src/nurturing/sync/sheets-reviewed-sync.service';
import { SheetsService } from '../src/sheets/sheets.service';
import { WordpressModule } from '../src/wordpress/wordpress.module';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), WordpressModule],
  providers: [SheetsService, SheetsReviewedSyncService],
})
class ForceRowSyncModule {}

async function main(): Promise<void> {
  const row = Number.parseInt(process.argv[2] || '', 10);
  if (!Number.isFinite(row) || row < 2) {
    throw new Error('Indica el número de fila del Sheet. Ejemplo: 618');
  }

  const app = await NestFactory.createApplicationContext(ForceRowSyncModule, {
    logger: ['log', 'warn', 'error'],
  });
  try {
    const sync = app.get(SheetsReviewedSyncService);
    const stats = await sync.syncReviewedRowsToWordpress(row, { force: true });
    console.log(JSON.stringify(stats, null, 2));
    if (!stats.posts?.length) {
      process.exitCode = 2;
    }
  } finally {
    await app.close();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
