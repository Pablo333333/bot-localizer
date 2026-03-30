import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { OutboundService } from './outbound/outbound.service';
import { SheetsController } from './sheets/sheets.controller';
import { SheetsService } from './sheets/sheets.service';
import { WordpressModule } from './wordpress/wordpress.module';
import { GoogleModule } from './google/google.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    WordpressModule,
    GoogleModule,
  ],
  controllers: [AppController, SheetsController],
  providers: [AppService, SheetsService, OutboundService],
})
export class AppModule {}
