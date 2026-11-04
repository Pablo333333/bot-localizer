import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  Req,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { CreateCheckoutSessionDto } from './dto/create-checkout-session.dto';
import { StartMembershipPaymentDto } from './dto/start-membership-payment.dto';
import { StripeService } from './stripe.service';

@Controller('stripe')
export class StripeController {
  private readonly logger = new Logger(StripeController.name);

  constructor(private readonly stripeService: StripeService) {}

  @Post('create-checkout-session')
  async createCheckoutSession(@Body() dto: CreateCheckoutSessionDto) {
    this.logger.log(
      `Solicitud de checkout: userId=${dto.userId} | mode=${dto.mode} | priceId=${dto.priceId}`,
    );

    const session = await this.stripeService.createCheckoutSession(dto);

    return {
      sessionId: session.sessionId,
      url: session.url,
    };
  }

  @Post('start-membership-payment')
  async startMembershipPayment(@Body() dto: StartMembershipPaymentDto) {
    this.logger.log(
      `Cobro de membresía: userId=${dto.userId} | mode=${dto.mode} | priceId=${dto.priceId} | pm=${dto.paymentMethodId}`,
    );
    return this.stripeService.startMembershipPayment(dto);
  }

  /**
   * Webhook Stripe.
   * - Firma inválida / cuerpo ausente → 400
   * - Evento válido o ya procesado → siempre 200 { received: true }
   *   aunque falle la sync WP (idempotencia / sin reintentos fallidos)
   */
  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  async handleWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('stripe-signature') signature: string,
  ) {
    try {
      if (!signature) {
        this.logger.warn('Webhook sin cabecera stripe-signature');
        throw new BadRequestException({
          received: false,
          error: 'missing_signature',
        });
      }

      if (!req.rawBody) {
        this.logger.error(
          'rawBody no disponible. Asegura NestFactory.create(..., { rawBody: true })',
        );
        throw new BadRequestException({
          received: false,
          error: 'raw_body_unavailable',
        });
      }

      let event;
      try {
        event = this.stripeService.constructEvent(req.rawBody, signature);
      } catch (err) {
        this.logger.warn(
          `Firma webhook inválida: ${err instanceof Error ? err.message : err}`,
        );
        throw new BadRequestException({
          received: false,
          error: 'invalid_signature',
        });
      }

      this.logger.log(`Webhook recibido: ${event.type} (${event.id})`);

      try {
        await this.stripeService.handleWebhookEvent(event);
      } catch (err) {
        this.logger.error(
          `Error procesando ${event.type} (${event.id}): ${
            err instanceof Error ? err.message : err
          }`,
          err instanceof Error ? err.stack : undefined,
        );
      }

      return { received: true };
    } catch (err) {
      if (err instanceof BadRequestException) {
        throw err;
      }
      this.logger.error(
        `Webhook Stripe no controlado: ${err instanceof Error ? err.message : err}`,
        err instanceof Error ? err.stack : undefined,
      );
      return { received: true, error: 'internal_handled' };
    }
  }
}
