import {
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

  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  async handleWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('stripe-signature') signature: string,
  ) {
    if (!signature) {
      this.logger.warn('Webhook sin cabecera stripe-signature');
      return { received: false };
    }

    if (!req.rawBody) {
      this.logger.error(
        'rawBody no disponible. Asegura NestFactory.create(..., { rawBody: true })',
      );
      return { received: false };
    }

    const event = this.stripeService.constructEvent(req.rawBody, signature);

    this.logger.log(`Webhook recibido: ${event.type} (${event.id})`);
    await this.stripeService.handleWebhookEvent(event);

    return { received: true };
  }
}
