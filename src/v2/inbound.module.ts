import { Module } from '@nestjs/common';
import { WordpressModule } from '../wordpress/wordpress.module';
import { CalendarService } from './calendar.service';
import { InboundService } from './inbound.service';

/**
 * Motor conversacional Localisto (OpenAI + calendario + CRM Sheets).
 * Compartido por WhatsApp (v2) y Meta (Messenger / Instagram DM).
 */
@Module({
  imports: [WordpressModule],
  providers: [InboundService, CalendarService],
  exports: [InboundService, CalendarService],
})
export class InboundModule {}
