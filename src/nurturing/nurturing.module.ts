import { Module, forwardRef } from '@nestjs/common';
import { SheetsModule } from '../sheets/sheets.module';
import { WordpressModule } from '../wordpress/wordpress.module';
import { CallChannel } from './channels/call.channel';
import { ChannelRegistry } from './channels/channel.registry';
import { EmailChannel } from './channels/email.channel';
import { SmsChannel } from './channels/sms.channel';
import { WhatsappChannel } from './channels/whatsapp.channel';
import { EnrollmentsService } from './enrollments/enrollments.service';
import { SequenceProcessor } from './engine/sequence.processor';
import { SequenceScheduler } from './engine/sequence.scheduler';
import { CallOutcomeClassifier } from './followup/call-outcome.classifier';
import { NoAnswerFollowupService } from './followup/no-answer-followup.service';
import { NurturingApiKeyGuard } from './guards/nurturing-api-key.guard';
import { LeadsController } from './leads/leads.controller';
import { LeadsService } from './leads/leads.service';
import { MetricsController } from './metrics/metrics.controller';
import { MetricsService } from './metrics/metrics.service';
import { SequencesController } from './sequences/sequences.controller';
import { SequencesService } from './sequences/sequences.service';
import { SheetsLeadSyncService } from './sync/sheets-lead-sync.service';
import { SheetsWordpressSyncService } from './sync/sheets-wordpress-sync.service';
import { SyncController } from './sync/sync.controller';

@Module({
  imports: [forwardRef(() => SheetsModule), WordpressModule],
  controllers: [
    LeadsController,
    SequencesController,
    MetricsController,
    SyncController,
  ],
  providers: [
    NurturingApiKeyGuard,
    LeadsService,
    SequencesService,
    MetricsService,
    EnrollmentsService,
    SequenceScheduler,
    SequenceProcessor,
    SheetsLeadSyncService,
    SheetsWordpressSyncService,
    CallOutcomeClassifier,
    NoAnswerFollowupService,
    ChannelRegistry,
    WhatsappChannel,
    EmailChannel,
    CallChannel,
    SmsChannel,
  ],
  exports: [
    LeadsService,
    SequencesService,
    EnrollmentsService,
    SheetsLeadSyncService,
    NoAnswerFollowupService,
    WhatsappChannel,
  ],
})
export class NurturingModule {}
