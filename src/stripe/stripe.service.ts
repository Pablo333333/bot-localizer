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

const DEFAULT_WP_BASE = 'https://www.localicer.com';

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
