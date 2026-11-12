/**
 * Reporte solo lectura: claims T+0 failed/sent y cupo backfill.
 * Uso (con túnel PG):
 *   $env:RAILWAY_PG_TUNNEL_URL="postgresql://...@127.0.0.1:5433/railway"
 *   npx ts-node --transpile-only -r tsconfig-paths/register scripts/report-backfill-t0-status.ts
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { preferReachableRailwayUrls, redactUrl } from './railway-local-urls';

async function main(): Promise<void> {
  const urls = preferReachableRailwayUrls();
  console.log(`[report] db=${redactUrl(urls.database)}`);

  const prisma = new PrismaClient();
  try {
    const madridNow = await prisma.$queryRaw<Array<{ madrid_now: string }>>`
      SELECT to_char(CURRENT_TIMESTAMP AT TIME ZONE 'Europe/Madrid', 'YYYY-MM-DD HH24:MI:SS') AS madrid_now
    `;

    const t0ByStatus = await prisma.$queryRaw<
      Array<{ t0_status: string; n: number }>
    >`
      SELECT COALESCE(metadata->>'phase3_backfill_t0_status', '(null)') AS t0_status,
             COUNT(*)::int AS n
      FROM "Lead"
      WHERE metadata ? 'phase3_backfill_t0_status'
         OR metadata ? 'phase3_backfill_t0_claimed_at'
      GROUP BY 1
      ORDER BY 2 DESC
    `;

    const failedToday = await prisma.$queryRaw<
      Array<{
        failed_t0_today: number;
        with_active: number;
        without_active: number;
      }>
    >`
      SELECT
        COUNT(*)::int AS failed_t0_today,
        COUNT(*) FILTER (
          WHERE EXISTS (
            SELECT 1 FROM "SequenceEnrollment" e
            WHERE e."leadId" = l.id AND e.status = 'active'
          )
        )::int AS with_active,
        COUNT(*) FILTER (
          WHERE NOT EXISTS (
            SELECT 1 FROM "SequenceEnrollment" e
            WHERE e."leadId" = l.id AND e.status = 'active'
          )
        )::int AS without_active
      FROM "Lead" l
      WHERE l.metadata->>'phase3_backfill_t0_status' = 'failed'
        AND (
          (l.metadata->>'phase3_backfill_date') =
            to_char(CURRENT_TIMESTAMP AT TIME ZONE 'Europe/Madrid', 'YYYY-MM-DD')
          OR (
            (l.metadata->>'phase3_backfill_t0_claimed_at') IS NOT NULL
            AND ((l.metadata->>'phase3_backfill_t0_claimed_at')::timestamptz
                 AT TIME ZONE 'Europe/Madrid')::date
              = (CURRENT_TIMESTAMP AT TIME ZONE 'Europe/Madrid')::date
          )
        )
    `;

    const enrollToday = await prisma.$queryRaw<Array<{ n: number }>>`
      SELECT COUNT(*)::int AS n
      FROM "SequenceEnrollment" e
      JOIN "Lead" l ON l.id = e."leadId"
      WHERE (e."enrolledAt" AT TIME ZONE 'Europe/Madrid')::date
              = (CURRENT_TIMESTAMP AT TIME ZONE 'Europe/Madrid')::date
        AND (
          l.source = 'sheets_backfill_unreached'
          OR (l.metadata->>'phase3_backfill') = 'true'
        )
    `;

    const logsToday = await prisma.$queryRaw<
      Array<{ summary: string; n: number }>
    >`
      SELECT summary, COUNT(*)::int AS n
      FROM "CommunicationLog"
      WHERE channel = 'whatsapp'
        AND summary LIKE 'backfill_t0%'
        AND ("createdAt" AT TIME ZONE 'Europe/Madrid')::date
              = (CURRENT_TIMESTAMP AT TIME ZONE 'Europe/Madrid')::date
      GROUP BY summary
      ORDER BY n DESC
    `;

    const activeBackfill = await prisma.$queryRaw<Array<{ n: number }>>`
      SELECT COUNT(DISTINCT l.id)::int AS n
      FROM "Lead" l
      JOIN "SequenceEnrollment" e ON e."leadId" = l.id AND e.status = 'active'
      WHERE l.source = 'sheets_backfill_unreached'
         OR (l.metadata->>'phase3_backfill') = 'true'
    `;

    // Sample of today's failed (phones redacted partially)
    const failedSample = await prisma.$queryRaw<
      Array<{
        phone: string;
        claimed_at: string | null;
        backfill_date: string | null;
        has_active: boolean;
      }>
    >`
      SELECT
        l.phone,
        l.metadata->>'phase3_backfill_t0_claimed_at' AS claimed_at,
        l.metadata->>'phase3_backfill_date' AS backfill_date,
        EXISTS (
          SELECT 1 FROM "SequenceEnrollment" e
          WHERE e."leadId" = l.id AND e.status = 'active'
        ) AS has_active
      FROM "Lead" l
      WHERE l.metadata->>'phase3_backfill_t0_status' = 'failed'
        AND (
          (l.metadata->>'phase3_backfill_date') =
            to_char(CURRENT_TIMESTAMP AT TIME ZONE 'Europe/Madrid', 'YYYY-MM-DD')
          OR (
            (l.metadata->>'phase3_backfill_t0_claimed_at') IS NOT NULL
            AND ((l.metadata->>'phase3_backfill_t0_claimed_at')::timestamptz
                 AT TIME ZONE 'Europe/Madrid')::date
              = (CURRENT_TIMESTAMP AT TIME ZONE 'Europe/Madrid')::date
          )
        )
      ORDER BY l."updatedAt" DESC
      LIMIT 15
    `;

    console.log(
      JSON.stringify(
        {
          madridNow: madridNow[0]?.madrid_now,
          t0ByStatus,
          failedToday: failedToday[0],
          backfillEnrollmentsToday: enrollToday[0]?.n ?? 0,
          backfillLeadsWithActiveEnrollment: activeBackfill[0]?.n ?? 0,
          communicationLogsToday: logsToday,
          failedSample,
        },
        null,
        2,
      ),
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
