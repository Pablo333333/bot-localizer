/**
 * `railway run` inyecta hosts `*.railway.internal` que no resolvemos desde el PC.
 * Preferimos URL pública si existe; si no, hay que tunelizar con:
 *   railway connect Postgres --tunnel-only --ssh
 *   railway connect Redis --tunnel-only --ssh
 */

function nonempty(raw?: string | null): string | undefined {
  const v = String(raw ?? '').trim();
  return v || undefined;
}

function isInternalRailwayUrl(url: string): boolean {
  return /\.railway\.internal(?::\d+)?/i.test(url);
}

/**
 * Ajusta DATABASE_URL / REDIS_URL en process.env antes de crear Prisma/BullMQ.
 * Devuelve qué fuente usó cada una (para logs).
 */
export function preferReachableRailwayUrls(env: NodeJS.ProcessEnv = process.env): {
  database: string;
  redis: string;
} {
  const databaseCandidates = [
    nonempty(env.DATABASE_PUBLIC_URL),
    nonempty(env.DATABASE_URL),
    nonempty(env.AUDIT_DATABASE_URL),
  ].filter(Boolean) as string[];

  const redisCandidates = [
    nonempty(env.REDIS_PUBLIC_URL),
    nonempty(env.REDIS_URL),
    nonempty(env.AUDIT_REDIS_URL),
  ].filter(Boolean) as string[];

  let database =
    databaseCandidates.find((url) => !isInternalRailwayUrl(url)) ||
    databaseCandidates[0] ||
    '';
  let redis =
    redisCandidates.find((url) => !isInternalRailwayUrl(url)) ||
    redisCandidates[0] ||
    'redis://127.0.0.1:6379';

  // Túnel local: railway connect ... --tunnel-only imprime puertos; el wrapper PS los pasa aquí.
  if (nonempty(env.RAILWAY_PG_TUNNEL_URL)) {
    database = env.RAILWAY_PG_TUNNEL_URL!;
  }
  if (nonempty(env.RAILWAY_REDIS_TUNNEL_URL)) {
    redis = env.RAILWAY_REDIS_TUNNEL_URL!;
  }

  if (!database || isInternalRailwayUrl(database)) {
    throw new Error(
      [
        'No hay una DATABASE_URL alcanzable desde este PC.',
        'postgres.railway.internal solo funciona dentro de Railway.',
        '',
        'Opciones:',
        '  1) En el dashboard de Postgres → Networking → Generate TCP Proxy, y añade DATABASE_PUBLIC_URL al servicio.',
        '  2) Desde PowerShell (recomendado sin proxy público):',
        '       npm run audit:fase3-ready:tunnel',
        '  3) Manual:',
        '       railway connect Postgres --tunnel-only --ssh',
        '       # luego: $env:RAILWAY_PG_TUNNEL_URL="postgresql://...@127.0.0.1:PORT/railway"',
        '',
        `DATABASE_URL actual: ${database || '(vacía)'}`,
      ].join('\n'),
    );
  }

  env.DATABASE_URL = database;
  env.REDIS_URL = redis;

  return { database, redis };
}

export function redactUrl(url: string): string {
  return url.replace(/:\/\/([^:@/]+):([^@/]+)@/g, '://$1:***@');
}
