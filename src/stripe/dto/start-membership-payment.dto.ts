import { IsEmail, IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { CheckoutMode } from './create-checkout-session.dto';

export class StartMembershipPaymentDto {
  @IsString()
  @IsNotEmpty()
  userId: string;

  @IsString()
  @IsNotEmpty()
  priceId: string;

  @IsEnum(CheckoutMode)
  mode: CheckoutMode;

  @IsEmail()
  customerEmail: string;

  /** PaymentMethod creado por Stripe Elements en el modal (pm_...). */
  @IsString()
  @IsNotEmpty()
  paymentMethodId: string;

  @IsOptional()
  @IsString()
  customerName?: string;
}
