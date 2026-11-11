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

/**
 * Lock de sesión (sobrevive varias transacciones). Usar para cupos diarios
 * que abarcan count + enroll + WA en el backfill.
 * Siempre liberar en finally.
 */
export async function withPhase3SessionLock<T>(
  db: LockClient,
  key: string,
  fn: () => Promise<T>,
): Promise<T> {
  await db.$executeRaw(
    Prisma.sql`SELECT pg_advisory_lock(hashtext(${key})::bigint)`,
  );
  try {
    return await fn();
  } finally {
    await db.$executeRaw(
      Prisma.sql`SELECT pg_advisory_unlock(hashtext(${key})::bigint)`,
    );
  }
}
