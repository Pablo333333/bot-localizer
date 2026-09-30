import { Prisma } from '@prisma/client';

type LockClient = {
  $executeRaw: (query: Prisma.Sql) => Promise<number>;
};

/** Serializa dos webhooks o dos jobs del mismo lead dentro de una transacción. */
export async function lockPhase3Key(
  db: LockClient,
  key: string,
): Promise<void> {
  await db.$executeRaw(
    Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${key})::bigint)`,
  );
}
