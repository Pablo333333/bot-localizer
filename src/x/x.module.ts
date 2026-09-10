import { Module } from '@nestjs/common';
import { XChatService } from './x-chat.service';
import { XController } from './x.controller';
import { XService } from './x.service';

/**
 * X (Twitter) Direct Messages → Localisto.
 * Prompt: Google Sheets Config_X!B2 (caché 60s); env/fallback solo si Sheets vacío.
 */
@Module({
  controllers: [XController],
  providers: [XService, XChatService],
  exports: [XService, XChatService],
})
export class XModule {}
