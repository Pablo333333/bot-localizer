import { Module, forwardRef } from '@nestjs/common';
import { SheetsModule } from '../../sheets/sheets.module';
import { NurturingModule } from '../nurturing.module';
import { OwnerReplyService } from './owner-reply.service';

@Module({
  imports: [SheetsModule, forwardRef(() => NurturingModule)],
  providers: [OwnerReplyService],
  exports: [OwnerReplyService],
})
export class OwnerReplyModule {}
