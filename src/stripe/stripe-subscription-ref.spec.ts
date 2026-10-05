import { subscriptionIdFromInvoice } from './stripe-subscription-ref';

describe('subscriptionIdFromInvoice', () => {
  it('lee la suscripción del parent de la API nueva', () => {
    expect(
      subscriptionIdFromInvoice({
        parent: {
          subscription_details: { subscription: 'sub_new' },
        },
      }),
    ).toBe('sub_new');
  });

  it('acepta el objeto expandido y el campo legacy', () => {
    expect(
      subscriptionIdFromInvoice({
        parent: {
          subscription_details: { subscription: { id: 'sub_obj' } },
        },
      }),
    ).toBe('sub_obj');
    expect(
      subscriptionIdFromInvoice({
        subscription: 'sub_legacy',
      }),
    ).toBe('sub_legacy');
  });
});
