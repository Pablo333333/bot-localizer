import {
  isOwnerContactRecorded,
  shouldAutoCreateWpListing,
} from './listing-creation-guard';

describe('shouldAutoCreateWpListing', () => {
  it('no crea pending si hubo llamada y el propietario no quedó contactado', () => {
    expect(
      shouldAutoCreateWpListing({
        callId: 'call_abc',
        propietarioContactado: 'NO',
      }),
    ).toBe(false);
    expect(
      shouldAutoCreateWpListing({
        callId: 'call_abc',
        propietarioContactado: '',
      }),
    ).toBe(false);
  });

  it('crea si el contacto quedó registrado o la ficha no tiene llamada', () => {
    expect(isOwnerContactRecorded('02/10/2026')).toBe(true);
    expect(
      shouldAutoCreateWpListing({
        callId: 'call_abc',
        propietarioContactado: '02/10/2026',
      }),
    ).toBe(true);
    expect(
      shouldAutoCreateWpListing({
        callId: '',
        propietarioContactado: '',
      }),
    ).toBe(true);
  });

  it('force publica aunque la conversación no conste', () => {
    expect(
      shouldAutoCreateWpListing({
        callId: 'call_abc',
        propietarioContactado: 'NO',
        force: true,
      }),
    ).toBe(true);
  });
});
