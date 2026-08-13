import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { NurturingApiKeyGuard } from '../guards/nurturing-api-key.guard';
import { MetricsQueryDto } from './dto';
import { MetricsService } from './metrics.service';

@Controller('nurturing/metrics')
@UseGuards(NurturingApiKeyGuard)
export class MetricsController {
  constructor(private readonly metricsService: MetricsService) {}

  @Get('summary')
  getSummary(@Query() query: MetricsQueryDto) {
    return this.metricsService.getSummary(query);
  }
}
