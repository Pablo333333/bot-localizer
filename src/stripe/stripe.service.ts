import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import { WordpressService } from '../wordpress/wordpress.service';
import {
  CheckoutMode,
  CreateCheckoutSessionDto,
} from './dto/create-checkout-session.dto';
import { StartMembershipPaymentDto } from './dto/start-membership-payment.dto';

const DEFAULT_WP_BASE = 'https://www.localicer.com';

function paymentIntentIdFromClientSecret(secret: string): string | null {
  const marker = '_secret';
  const index = secret.indexOf(marker);
  if (index <= 0) return null;
  return secret.slice(0, index);
}

@Injectable()
export class StripeService {
  private readonly logger = new Logger(StripeService.name);
  private readonly stripe: Stripe;
  private readonly webhookSecret: string;
  private readonly successUrl: string;
  private readonly cancelUrl: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly wordpressService: WordpressService,
  ) {
    const secretKey = this.configService.getOrThrow<string>('STRIPE_SECRET_KEY');
    this.webhookSecret = this.configService.getOrThrow<string>(
      'STRIPE_WEBHOOK_SECRET',
    );

    this.stripe = new Stripe(secretKey);

    const wpBase = (
      this.configService.get<string>('WP_URL') || DEFAULT_WP_BASE
    ).replace(/\/$/, '');

    // Toni: success debe devolver session_id a Mi Perfil
    this.successUrl = `${wpBase}/mi-perfil/?session_id={CHECKOUT_SESSION_ID}`;
    this.cancelUrl = `${wpBase}/volver-a-intentar/`;
  }

  async createCheckoutSession(
    dto: CreateCheckoutSessionDto,
  ): Promise<{ sessionId: string; url: string | null }> {
    const { userId, priceId, mode, customerEmail } = dto;

    try {
      const sessionParams: Stripe.Checkout.SessionCreateParams = {
        mode,
        customer_email: customerEmail,
        client_reference_id: userId,
        line_items: [{ price: priceId, quantity: 1 }],
        success_url: this.successUrl,
        cancel_url: this.cancelUrl,
        metadata: {
          userId,
          priceId,
          customerEmail,
        },
      };

      if (mode === CheckoutMode.SUBSCRIPTION) {
        sessionParams.subscription_data = {
          metadata: { userId, priceId },
        };
      }

      const session = await this.stripe.checkout.sessions.create(sessionParams);

      this.logger.log(
        `Checkout session creada: ${session.id} | userId=${userId} | mode=${mode}`,
      );

      return { sessionId: session.id, url: session.url };
    } catch (error) {
      this.logger.error(
        `Error al crear Checkout Session: ${(error as Error).message}`,
        (error as Error).stack,
      );
      throw new InternalServerErrorException(
        'No se pudo crear la sesión de pago de Stripe',
      );
    }
  }

  /**
   * Cobra la tarjeta que Stripe Elements ya tokenizó en el modal (pm_...).
   * La 4242 queda en succeeded sin salir del sitio; 3DS devuelve clientSecret.
   */
  async startMembershipPayment(dto: StartMembershipPaymentDto): Promise<{
    status: string;
    url: string;
    clientSecret: string | null;
    subscriptionId?: string;
  }> {
    const { userId, priceId, mode, customerEmail, paymentMethodId, customerName } =
      dto;

    if (!paymentMethodId.startsWith('pm_')) {
      throw new BadRequestException(
        'El formulario no envió un método de pago de Stripe (pm_).',
      );
    }

    try {
      const customer = await this.findOrCreateCustomer({
        email: customerEmail,
        name: customerName,
        userId,
        paymentMethodId,
      });

      if (mode === CheckoutMode.PAYMENT) {
        const intent = await this.stripe.paymentIntents.create({
          amount: await this.priceAmount(priceId),
          currency: await this.priceCurrency(priceId),
          customer: customer.id,
          payment_method: paymentMethodId,
          confirm: true,
          automatic_payment_methods: {
            enabled: true,
            allow_redirects: 'never',
          },
          metadata: { userId, priceId, customerEmail },
        });
        return this.finishIntent({
          intent,
          userId,
          email: customerEmail,
          priceId,
          mode,
          customerId: customer.id,
        });
      }

      const subscription = await this.stripe.subscriptions.create({
        customer: customer.id,
        items: [{ price: priceId }],
        default_payment_method: paymentMethodId,
        payment_behavior: 'default_incomplete',
        payment_settings: {
          save_default_payment_method: 'on_subscription',
        },
        metadata: { userId, priceId },
        expand: ['latest_invoice.confirmation_secret'],
      });

      const invoice = subscription.latest_invoice;
      const clientSecret =
        invoice && typeof invoice !== 'string'
          ? invoice.confirmation_secret?.client_secret || null
          : null;
      const intentId = clientSecret
        ? paymentIntentIdFromClientSecret(clientSecret)
        : null;
      const intent = intentId
        ? await this.stripe.paymentIntents.retrieve(intentId)
        : null;

      const confirmed =
        intent &&
        (intent.status === 'requires_confirmation' ||
          intent.status === 'requires_payment_method')
          ? await this.stripe.paymentIntents.confirm(intent.id, {
              payment_method: paymentMethodId,
            })
          : intent;

      if (!confirmed) {
        const invoiceId =
          !invoice ? null : typeof invoice === 'string' ? invoice : invoice.id;
        if (!invoiceId) {
          throw new InternalServerErrorException(
            'Stripe no devolvió el PaymentIntent de la suscripción',
          );
        }
        const paid = await this.stripe.invoices.pay(invoiceId, {
          payment_method: paymentMethodId,
        });
        if (paid.status !== 'paid') {
          throw new BadRequestException('No se pudo iniciar el pago');
        }
        const wpBase = (
          this.configService.get<string>('WP_URL') || DEFAULT_WP_BASE
        ).replace(/\/$/, '');
        await this.wordpressService.activateUserPlan({
          userId,
          email: customerEmail,
          priceId,
          mode,
          stripeSubscriptionId: subscription.id,
          stripeCustomerId: customer.id,
          stripeInvoiceId: invoiceId,
          event: 'invoice.payment_succeeded',
          meta: { plan_status: 'active' },
        });
        return {
          status: 'succeeded',
          url: `${wpBase}/mi-perfil/`,
          clientSecret: null,
          subscriptionId: subscription.id,
        };
      }

      const result = await this.finishIntent({
        intent: confirmed,
        userId,
        email: customerEmail,
        priceId,
        mode,
        customerId: customer.id,
        subscriptionId: subscription.id,
      });
      return result;
    } catch (error) {
      if (
        error instanceof BadRequestException ||
        error instanceof InternalServerErrorException
      ) {
        throw error;
      }
      const stripeError = error as Stripe.errors.StripeError;
      this.logger.error(
        `Error al cobrar membresía: ${stripeError.message}`,
        stripeError.stack,
      );
      throw new BadRequestException(
        stripeError.message || 'No se pudo iniciar el pago',
      );
    }
  }

  private async findOrCreateCustomer(params: {
    email: string;
    name?: string;
    userId: string;
    paymentMethodId: string;
  }): Promise<Stripe.Customer> {
    const existing = await this.stripe.customers.list({
      email: params.email,
      limit: 1,
    });
    const customer =
      existing.data[0] ||
      (await this.stripe.customers.create({
        email: params.email,
        name: params.name || undefined,
        metadata: { userId: params.userId },
      }));

    try {
      await this.stripe.paymentMethods.attach(params.paymentMethodId, {
        customer: customer.id,
      });
    } catch (error) {
      const message = (error as Error).message || '';
      if (!/already been attached/i.test(message)) {
        throw error;
      }
    }

    await this.stripe.customers.update(customer.id, {
      invoice_settings: { default_payment_method: params.paymentMethodId },
    });
    return customer;
  }

  private async priceAmount(priceId: string): Promise<number> {
    const price = await this.stripe.prices.retrieve(priceId);
    if (!price.unit_amount) {
      throw new BadRequestException('El precio de Stripe no tiene importe');
    }
    return price.unit_amount;
  }

  private async priceCurrency(priceId: string): Promise<string> {
    const price = await this.stripe.prices.retrieve(priceId);
    return price.currency;
  }

  private async finishIntent(params: {
    intent: Stripe.PaymentIntent;
    userId: string;
    email: string;
    priceId: string;
    mode: CheckoutMode;
    customerId: string;
    subscriptionId?: string;
  }): Promise<{
    status: string;
    url: string;
    clientSecret: string | null;
    subscriptionId?: string;
  }> {
    const wpBase = (
      this.configService.get<string>('WP_URL') || DEFAULT_WP_BASE
    ).replace(/\/$/, '');
    const url = `${wpBase}/mi-perfil/`;
    const needsAction =
      params.intent.status === 'requires_action' ||
      params.intent.status === 'requires_confirmation';

    if (params.intent.status === 'succeeded' || params.intent.status === 'processing') {
      await this.wordpressService.activateUserPlan({
        userId: params.userId,
        email: params.email,
        priceId: params.priceId,
        mode: params.mode,
        stripeSubscriptionId: params.subscriptionId,
        stripeCustomerId: params.customerId,
        event: 'invoice.payment_succeeded',
        meta: {
          plan_status: 'active',
          payment_intent: params.intent.id,
        },
      });
    }

    return {
      status: params.intent.status,
      url: needsAction ? '' : url,
      clientSecret: needsAction ? params.intent.client_secret : null,
      subscriptionId: params.subscriptionId,
    };
  }

  constructEvent(rawBody: Buffer, signature: string): Stripe.Event {
    try {
      return this.stripe.webhooks.constructEvent(
        rawBody,
        signature,
        this.webhookSecret,
      );
    } catch (error) {
      this.logger.warn(
        `Firma de webhook inválida: ${(error as Error).message}`,
      );
      throw new BadRequestException('Webhook signature verification failed');
    }
  }

  async handleWebhookEvent(event: Stripe.Event): Promise<void> {
    switch (event.type) {
      case 'checkout.session.completed':
        await this.handleCheckoutSessionCompleted(
          event.data.object as Stripe.Checkout.Session,
        );
        break;

      case 'invoice.payment_succeeded':
        await this.handleInvoicePaymentSucceeded(
          event.data.object as Stripe.Invoice,
        );
        break;

      case 'customer.subscription.deleted':
        await this.handleSubscriptionDeleted(
          event.data.object as Stripe.Subscription,
        );
        break;

      default:
        this.logger.debug(`Evento Stripe ignorado: ${event.type}`);
    }
  }

  private async handleCheckoutSessionCompleted(
    session: Stripe.Checkout.Session,
  ): Promise<void> {
    const userId =
      session.client_reference_id || session.metadata?.userId || undefined;
    const email =
      session.customer_email ||
      session.customer_details?.email ||
      session.metadata?.customerEmail ||
      undefined;
    const priceId =
      session.metadata?.priceId ||
      (await this.resolvePriceIdFromSession(session.id));
    const mode = session.mode as 'payment' | 'subscription' | undefined;

    const subscriptionId =
      typeof session.subscription === 'string'
        ? session.subscription
        : session.subscription?.id;
    const customerId =
      typeof session.customer === 'string'
        ? session.customer
        : session.customer?.id;

    this.logger.log(
      `[checkout.session.completed] userId=${userId ?? 'n/a'} | mode=${mode} | priceId=${priceId ?? 'n/a'} | session=${session.id}`,
    );

    if (!userId && !email) {
      this.logger.warn(
        `Checkout ${session.id} sin userId ni email; no se sincroniza con WP`,
      );
      return;
    }

    await this.wordpressService.activateUserPlan({
      userId: userId || email!,
      email,
      priceId,
      mode,
      stripeSessionId: session.id,
      stripeSubscriptionId: subscriptionId,
      stripeCustomerId: customerId,
      event: 'checkout.session.completed',
      meta: {
        plan_status: 'active',
        checkout_mode: mode ?? '',
      },
    });
  }

  private async handleInvoicePaymentSucceeded(
    invoice: Stripe.Invoice,
  ): Promise<void> {
    const billingReason = invoice.billing_reason;
    const subscriptionRef =
      invoice.parent?.subscription_details?.subscription;
    const subscriptionId =
      typeof subscriptionRef === 'string'
        ? subscriptionRef
        : subscriptionRef?.id;

    this.logger.log(
      `[invoice.payment_succeeded] invoice=${invoice.id} | reason=${billingReason ?? 'n/a'} | subscription=${subscriptionId ?? 'n/a'}`,
    );

    // El alta inicial ya se gestiona en checkout.session.completed
    if (billingReason === 'subscription_create') {
      this.logger.debug(
        `Omitiendo invoice ${invoice.id}: alta cubierta por checkout.session.completed`,
      );
      return;
    }

    let userId: string | undefined;
    let priceId: string | undefined;

    if (subscriptionId) {
      const subscription =
        await this.stripe.subscriptions.retrieve(subscriptionId);
      userId = subscription.metadata?.userId;
      priceId =
        subscription.metadata?.priceId ||
        subscription.items.data[0]?.price?.id;
    }

    const email = invoice.customer_email || undefined;
    const customerId =
      typeof invoice.customer === 'string'
        ? invoice.customer
        : invoice.customer?.id;

    if (!userId && !email) {
      this.logger.warn(
        `Invoice ${invoice.id} sin userId ni email; no se sincroniza renovación con WP`,
      );
      return;
    }

    await this.wordpressService.activateUserPlan({
      userId: userId || email!,
      email: email || undefined,
      priceId,
      mode: 'subscription',
      stripeSubscriptionId: subscriptionId,
      stripeCustomerId: customerId,
      stripeInvoiceId: invoice.id,
      event: 'invoice.payment_succeeded',
      meta: {
        plan_status: 'active',
        renewal: true,
      },
    });
  }

  private async handleSubscriptionDeleted(
    subscription: Stripe.Subscription,
  ): Promise<void> {
    const userId = subscription.metadata?.userId;
    const priceId =
      subscription.metadata?.priceId ||
      subscription.items.data[0]?.price?.id;
    const customerId =
      typeof subscription.customer === 'string'
        ? subscription.customer
        : subscription.customer?.id;

    this.logger.log(
      `[customer.subscription.deleted] subscription=${subscription.id} | userId=${userId ?? 'n/a'}`,
    );

    if (!userId) {
      this.logger.warn(
        `Suscripción ${subscription.id} sin metadata.userId; no se puede cancelar en WP`,
      );
      return;
    }

    await this.wordpressService.cancelUserPlan({
      userId,
      priceId,
      mode: 'subscription',
      stripeSubscriptionId: subscription.id,
      stripeCustomerId: customerId,
      event: 'customer.subscription.deleted',
      meta: {
        plan_status: 'cancelled',
        // WordPress puede mapear esto a rol gratuito / anuncios_limite=0
        revert_to_free: true,
      },
    });
  }

  private async resolvePriceIdFromSession(
    sessionId: string,
  ): Promise<string | undefined> {
    try {
      const lineItems = await this.stripe.checkout.sessions.listLineItems(
        sessionId,
        { limit: 1 },
      );
      const price = lineItems.data[0]?.price;
      return typeof price === 'string' ? price : price?.id;
    } catch (error) {
      this.logger.warn(
        `No se pudo obtener priceId de la sesión ${sessionId}: ${(error as Error).message}`,
      );
      return undefined;
    }
  }
}
