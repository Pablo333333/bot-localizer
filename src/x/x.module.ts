import { Module } from '@nestjs/common';
import { XChatService } from './x-chat.service';
import { XController } from './x.controller';
import { XService } from './x.service';

/**
 * X (Twitter) Direct Messages → Localisto.
 * Prompt provisional: env X_DM_SYSTEM_PROMPT o fallback genérico (luego Sheets/DB).
 */
@Module({
  controllers: [XController],
  providers: [XService, XChatService],
  exports: [XService, XChatService],
})
export class XModule {}
