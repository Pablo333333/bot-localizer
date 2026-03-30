import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { WordpressService } from './wordpress.service';

@Module({
  imports: [HttpModule],
  providers: [WordpressService],
  exports: [WordpressService],
})
export class WordpressModule {}
