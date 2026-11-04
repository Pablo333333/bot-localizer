import { Module } from '@nestjs/common';
import { InboundModule } from '../v2/inbound.module';
import { AgendarLlamadaController } from './agendar-llamada.controller';
import { RetellWebhookGuard } from './retell-webhook.guard';

@Module({
  imports: [InboundModule],
  controllers: [AgendarLlamadaController],
  providers: [RetellWebhookGuard],
  exports: [RetellWebhookGuard],
})
export class RetellToolsModule {}
