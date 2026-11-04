/**
 * Serializa creaciones de estate_property por callId / fila Sheet
 * para evitar doble create (webhook Retell + cron Reviewed en paralelo).
 */

const locks = new Map<string, Promise<unknown>>();

export function wpCreateLockKey(params: {
  callId?: string | null;
  phone?: string | null;
  rowNumber?: number | null;
}): string {
  const callId = String(params.callId ?? '')
    .trim()
    .toLowerCase();
  if (callId) return `call:${callId}`;

  const phone = String(params.phone ?? '').replace(/\D/g, '');
  if (phone.length >= 9) return `phone:${phone.slice(-9)}`;

  const row = params.rowNumber;
  if (row != null && Number.isFinite(row) && row > 0) {
    return `row:${Math.floor(row)}`;
  }

  return `anon:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
}

export async function withWpCreateLock<T>(
  key: string,
  fn: () => Promise<T>,
): Promise<T> {
  const previous = locks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const chained = previous.then(() => gate);
  locks.set(
    key,
    chained.catch(() => undefined),
  );

  await previous;
  try {
    return await fn();
  } finally {
    release();
    if (locks.get(key) === chained) {
      locks.delete(key);
    }
  }
}
