import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { CommercialDescriptionService } from './commercial-description.service';
import { WordpressService } from './wordpress.service';

@Module({
  imports: [HttpModule],
  providers: [WordpressService, CommercialDescriptionService],
  exports: [WordpressService, CommercialDescriptionService],
})
export class WordpressModule {}
