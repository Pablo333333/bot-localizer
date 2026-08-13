import { Global, Module, forwardRef } from '@nestjs/common';
import { GoogleModule } from '../google/google.module';
import { PropertyPublishEmailService } from '../notifications/property-publish-email.service';
import { NurturingModule } from '../nurturing/nurturing.module';
import { WordpressModule } from '../wordpress/wordpress.module';
import { SheetsController } from './sheets.controller';
import { SheetsService } from './sheets.service';

@Global()
@Module({
  imports: [
    WordpressModule,
    GoogleModule,
    forwardRef(() => NurturingModule),
  ],
  controllers: [SheetsController],
  providers: [SheetsService, PropertyPublishEmailService],
  exports: [SheetsService, PropertyPublishEmailService],
})
export class SheetsModule {}
