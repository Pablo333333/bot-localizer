import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { GoogleModule } from '../google/google.module';
import { CommercialDescriptionService } from './commercial-description.service';
import { PropertyMediaService } from './property-media.service';
import { WordpressService } from './wordpress.service';

@Module({
  imports: [HttpModule, GoogleModule],
  providers: [
    WordpressService,
    CommercialDescriptionService,
    PropertyMediaService,
  ],
  exports: [
    WordpressService,
    CommercialDescriptionService,
    PropertyMediaService,
  ],
})
export class WordpressModule {}
