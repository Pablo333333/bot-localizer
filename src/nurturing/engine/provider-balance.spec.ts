import {
  AWAITING_PROVIDER_BALANCE,
  isProviderBalanceError,
} from './provider-balance';

describe('isProviderBalanceError', () => {
  it('detecta saldo agotado en Retell y Twilio', () => {
    expect(isProviderBalanceError('Insufficient balance to place call')).toBe(
      true,
    );
    expect(isProviderBalanceError('Account suspended', 30002)).toBe(true);
    expect(isProviderBalanceError('Payment required', 402)).toBe(true);
    expect(isProviderBalanceError('saldo insuficiente en la cuenta')).toBe(
      true,
    );
    expect(isProviderBalanceError(AWAITING_PROVIDER_BALANCE)).toBe(false);
  });

  it('no trata un fallo de plantilla o de número como falta de saldo', () => {
    expect(isProviderBalanceError('Invalid phone number')).toBe(false);
    expect(isProviderBalanceError('Content template not approved')).toBe(
      false,
    );
    expect(isProviderBalanceError('')).toBe(false);
  });
});
