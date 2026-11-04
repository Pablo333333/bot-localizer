import { isPermanentMessagingError } from './permanent-messaging-error';

describe('isPermanentMessagingError', () => {
  it('detecta Twilio 63007 (canal/plantilla no encontrado)', () => {
    expect(
      isPermanentMessagingError(
        'Twilio could not find a Channel with the specified From address',
        63007,
      ),
    ).toBe(true);
  });

  it('detecta cuenta inactiva por mensaje', () => {
    expect(
      isPermanentMessagingError('Account is inactive or disabled', null),
    ).toBe(true);
  });

  it('no marca errores de saldo como permanentes', () => {
    expect(
      isPermanentMessagingError('insufficient funds', 30002),
    ).toBe(false);
  });
});
