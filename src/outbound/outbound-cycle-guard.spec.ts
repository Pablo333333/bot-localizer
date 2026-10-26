import {
  isProviderTokenFailure,
  OUTBOUND_CYCLE_STALE_MS,
  shouldSkipOutboundCycle,
  withTimeout,
} from './outbound-cycle-guard';

describe('outbound-cycle-guard', () => {
  it('ignora un ciclo en curso y recupera el lock si ya expiró', () => {
    const now = 1_000_000;
    expect(
      shouldSkipOutboundCycle({ running: true, runningSince: now - 10_000 }, now),
    ).toBe(true);
    expect(
      shouldSkipOutboundCycle(
        { running: true, runningSince: now - OUTBOUND_CYCLE_STALE_MS },
        now,
      ),
    ).toBe(false);
    expect(shouldSkipOutboundCycle({ running: false, runningSince: 0 }, now)).toBe(
      false,
    );
  });

  it('reconoce fallos de token y no un error cualquiera', () => {
    expect(isProviderTokenFailure('invalid_grant: Token has been expired')).toBe(
      true,
    );
    expect(isProviderTokenFailure('Request failed with status code 401')).toBe(
      true,
    );
    expect(isProviderTokenFailure('Missing lock for job token')).toBe(true);
    expect(isProviderTokenFailure('Fila 12 sin teléfono')).toBe(false);
  });

  it('corta una promesa que no termina', async () => {
    await expect(
      withTimeout(new Promise(() => undefined), 20, 'Sheet'),
    ).rejects.toThrow(/Sheet superó 20 ms/);
  });
});
