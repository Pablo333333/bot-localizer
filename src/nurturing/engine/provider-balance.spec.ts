import {
  AWAITING_PROVIDER_BALANCE,
  PROVIDER_BALANCE_EXHAUSTED,
  PROVIDER_BALANCE_MAX_AGE_MS,
  PROVIDER_BALANCE_MAX_PARKS,
  formatBalanceHoldState,
  isAwaitingProviderBalance,
  isProviderBalanceError,
  isProviderBalanceExhausted,
  nextBalanceHoldState,
  parseBalanceHoldState,
  shouldExhaustBalanceHold,
} from './provider-balance';

describe('isProviderBalanceError', () => {
  it('detecta saldo agotado en Retell y Twilio', () => {
    expect(isProviderBalanceError('Insufficient balance to place call')).toBe(
      true,
    );
    expect(isProviderBalanceError('Payment required', 402)).toBe(true);
    expect(isProviderBalanceError('saldo insuficiente en la cuenta')).toBe(
      true,
    );
    expect(isProviderBalanceError(AWAITING_PROVIDER_BALANCE)).toBe(true);
    expect(
      isProviderBalanceError(
        `${AWAITING_PROVIDER_BALANCE}|parks=2|since=1`,
      ),
    ).toBe(true);
  });

  it('no trata cuenta suspendida / plantilla / número como falta de saldo', () => {
    expect(isProviderBalanceError('Account suspended', 30002)).toBe(false);
    expect(isProviderBalanceError('Invalid phone number')).toBe(false);
    expect(isProviderBalanceError('Content template not approved')).toBe(
      false,
    );
    expect(isProviderBalanceError(PROVIDER_BALANCE_EXHAUSTED)).toBe(false);
    expect(isProviderBalanceError('')).toBe(false);
  });
});

describe('balance hold cap', () => {
  it('parsea e incrementa parks', () => {
    const first = nextBalanceHoldState(null, 1_000);
    expect(first).toEqual({ parks: 1, sinceMs: 1_000 });
    const encoded = formatBalanceHoldState(first);
    expect(isAwaitingProviderBalance(encoded)).toBe(true);
    const second = nextBalanceHoldState(encoded, 2_000);
    expect(second.parks).toBe(2);
    expect(second.sinceMs).toBe(1_000);
  });

  it('agota por parks o por edad', () => {
    expect(
      shouldExhaustBalanceHold({
        parks: PROVIDER_BALANCE_MAX_PARKS,
        sinceMs: Date.now(),
      }),
    ).toBe(true);
    expect(
      shouldExhaustBalanceHold({
        parks: 1,
        sinceMs: Date.now() - PROVIDER_BALANCE_MAX_AGE_MS - 1,
      }),
    ).toBe(true);
    expect(
      shouldExhaustBalanceHold({ parks: 1, sinceMs: Date.now() }),
    ).toBe(false);
  });

  it('detecta exhausted', () => {
    expect(isProviderBalanceExhausted(PROVIDER_BALANCE_EXHAUSTED)).toBe(true);
    expect(
      isProviderBalanceExhausted(`${PROVIDER_BALANCE_EXHAUSTED}|parks=36`),
    ).toBe(true);
    expect(parseBalanceHoldState(AWAITING_PROVIDER_BALANCE, 50)?.parks).toBe(
      0,
    );
  });
});
