import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { NURTURING_STEPS_QUEUE } from './queue.constants';

@Global()
@Module({
  imports: [
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: {
          url: config.get<string>('REDIS_URL') || 'redis://127.0.0.1:6379',
        },
      }),
    }),
    BullModule.registerQueue({ name: NURTURING_STEPS_QUEUE }),
  ],
  exports: [BullModule],
})
export class QueueModule {}
