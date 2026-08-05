import { IsEmail, IsEnum, IsNotEmpty, IsString } from 'class-validator';

export enum CheckoutMode {
  PAYMENT = 'payment',
  SUBSCRIPTION = 'subscription',
}

export class CreateCheckoutSessionDto {
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
}
