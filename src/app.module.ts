import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'path';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { OutboundService } from './outbound/outbound.service';
import { SheetsModule } from './sheets/sheets.module';
import { WordpressModule } from './wordpress/wordpress.module';
import { GoogleModule } from './google/google.module';
import { StripeModule } from './stripe/stripe.module';
import { WhatsAppWebhook } from './v2/whatsapp.webhook';
import { InboundModule } from './v2/inbound.module';
import { PrismaModule } from './prisma/prisma.module';
import { QueueModule } from './queue/queue.module';
import { NurturingModule } from './nurturing/nurturing.module';
import { MetaModule } from './meta/meta.module';
import { XModule } from './x/x.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    ServeStaticModule.forRoot({
      rootPath: join(process.cwd(), 'public'),
      exclude: ['/api*', '/v2*', '/stripe*', '/nurturing*', '/meta*', '/x*'],
    }),
    PrismaModule,
    QueueModule,
    SheetsModule,
    WordpressModule,
    GoogleModule,
    StripeModule,
    NurturingModule,
    InboundModule,
    MetaModule,
    XModule,
  ],
  controllers: [AppController, WhatsAppWebhook],
  providers: [AppService, OutboundService],
})
export class AppModule {}
