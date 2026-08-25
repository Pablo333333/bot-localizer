import { Module } from '@nestjs/common';
import { XController } from './x.controller';
import { XService } from './x.service';

/**
 * Stub Fase 4+ — integración futura con X (Twitter) Direct Messages.
 * No procesa automáticamente; solo estructura base y verificación webhook.
 */
@Module({
  controllers: [XController],
  providers: [XService],
  exports: [XService],
})
export class XModule {}
