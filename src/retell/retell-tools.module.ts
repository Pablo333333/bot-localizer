import { Module } from '@nestjs/common';
import { InboundModule } from '../v2/inbound.module';
import { AgendarLlamadaController } from './agendar-llamada.controller';

@Module({
  imports: [InboundModule],
  controllers: [AgendarLlamadaController],
})
export class RetellToolsModule {}
