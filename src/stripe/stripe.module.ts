import { Module } from '@nestjs/common';
import { WordpressModule } from '../wordpress/wordpress.module';
import { StripeController } from './stripe.controller';
import { StripeService } from './stripe.service';

@Module({
  imports: [WordpressModule],
  controllers: [StripeController],
  providers: [StripeService],
  exports: [StripeService],
})
export class StripeModule {}
