import { Module } from '@nestjs/common';
import { InboundModule } from '../v2/inbound.module';
import { XChatService } from './x-chat.service';
import { XController } from './x.controller';
import { XService } from './x.service';

/**
 * X (Twitter) Direct Messages → Localisto (Retell X_AGENT_ID / InboundService).
 * Solo DMs; no tweets ni menciones.
 */
@Module({
  imports: [InboundModule],
  controllers: [XController],
  providers: [XService, XChatService],
  exports: [XService, XChatService],
})
export class XModule {}
