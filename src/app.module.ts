import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'path';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { OutboundService } from './outbound/outbound.service';
import { SheetsController } from './sheets/sheets.controller';
import { SheetsService } from './sheets/sheets.service';
import { WordpressModule } from './wordpress/wordpress.module';
import { GoogleModule } from './google/google.module';
import { InboundService } from './v2/inbound.service';
import { WhatsAppWebhook } from './v2/whatsapp.webhook';
import { CalendarService } from './v2/calendar.service';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    ServeStaticModule.forRoot({
      rootPath: join(process.cwd(), 'public'),
      exclude: ['/api/(.*)', '/v2/(.*)'],
    }),
    WordpressModule,
    GoogleModule,
  ],
  controllers: [AppController, SheetsController, WhatsAppWebhook],
  providers: [AppService, SheetsService, OutboundService, InboundService, CalendarService],
})
export class AppModule {}
