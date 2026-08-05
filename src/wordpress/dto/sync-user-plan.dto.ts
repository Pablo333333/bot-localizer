export type PlanStatus = 'active' | 'cancelled' | 'free';

export type StripePlanEvent =
  | 'checkout.session.completed'
  | 'invoice.payment_succeeded'
  | 'customer.subscription.deleted';

export interface SyncUserPlanPayload {
  /** ID de usuario en WordPress (client_reference_id / metadata.userId) */
  userId: string;
  email?: string;
  priceId?: string;
  planStatus: PlanStatus;
  mode?: 'payment' | 'subscription';
  stripeSessionId?: string;
  stripeSubscriptionId?: string;
  stripeCustomerId?: string;
  stripeInvoiceId?: string;
  event: StripePlanEvent;
  /** Meta extra opcional (límites, rol, etc.) */
  meta?: Record<string, string | number | boolean>;
}
