import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { NurturingApiKeyGuard } from '../guards/nurturing-api-key.guard';
import { CancelEnrollmentDto, CreateSequenceDto, EnrollLeadDto } from './dto';
import { SequencesService } from './sequences.service';

@Controller('nurturing/sequences')
@UseGuards(NurturingApiKeyGuard)
export class SequencesController {
  constructor(private readonly sequencesService: SequencesService) {}

  @Post()
  create(@Body() dto: CreateSequenceDto) {
    return this.sequencesService.create(dto);
  }

  @Get()
  findAll() {
    return this.sequencesService.findAll();
  }

  @Get('default')
  findDefault() {
    return this.sequencesService.findDefault();
  }

  @Post('enroll')
  enroll(@Body() dto: EnrollLeadDto) {
    return this.sequencesService.enroll(dto);
  }

  @Post('enrollments/:id/cancel')
  cancel(@Param('id') id: string, @Body() dto: CancelEnrollmentDto) {
    return this.sequencesService.cancel(id, dto);
  }
}
