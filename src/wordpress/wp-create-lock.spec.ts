import { withWpCreateLock, wpCreateLockKey } from './wp-create-lock';

describe('wpCreateLockKey', () => {
  it('prioriza callId, luego teléfono, luego fila', () => {
    expect(wpCreateLockKey({ callId: 'Call_ABC' })).toBe('call:call_abc');
    expect(wpCreateLockKey({ phone: '+34644408099' })).toBe('phone:644408099');
    expect(wpCreateLockKey({ rowNumber: 12 })).toBe('row:12');
  });
});

describe('withWpCreateLock', () => {
  it('serializa trabajo concurrente con la misma clave', async () => {
    const order: number[] = [];
    await Promise.all([
      withWpCreateLock('k', async () => {
        order.push(1);
        await new Promise((r) => setTimeout(r, 30));
        order.push(2);
      }),
      withWpCreateLock('k', async () => {
        order.push(3);
        order.push(4);
      }),
    ]);
    expect(order).toEqual([1, 2, 3, 4]);
  });
});
