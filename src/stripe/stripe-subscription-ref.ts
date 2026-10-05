type SubscriptionRef = string | { id?: string | null } | null | undefined;

/**
 * Stripe API reciente mueve la suscripción a invoice.parent.
 * Los eventos de prueba antiguos siguen trayendo invoice.subscription.
 */
export function subscriptionIdFromInvoice(invoice: {
  parent?: {
    subscription_details?: {
      subscription?: SubscriptionRef;
    } | null;
  } | null;
  subscription?: SubscriptionRef;
}): string | undefined {
  const parent = invoice.parent?.subscription_details?.subscription;
  if (typeof parent === 'string' && parent) return parent;
  if (parent && typeof parent === 'object' && parent.id) return parent.id;

  const legacy = invoice.subscription;
  if (typeof legacy === 'string' && legacy) return legacy;
  if (legacy && typeof legacy === 'object' && legacy.id) return legacy.id;
  return undefined;
}
