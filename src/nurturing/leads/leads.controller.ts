import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { NurturingApiKeyGuard } from '../guards/nurturing-api-key.guard';
import { CreateLeadDto, QueryLeadsDto, UpdateLeadStatusDto } from './dto';
import { LeadsService } from './leads.service';

@Controller('nurturing/leads')
@UseGuards(NurturingApiKeyGuard)
export class LeadsController {
  constructor(private readonly leadsService: LeadsService) {}

  @Post()
  create(@Body() dto: CreateLeadDto) {
    return this.leadsService.create(dto);
  }

  @Get()
  findAll(@Query() query: QueryLeadsDto) {
    return this.leadsService.findAll(query);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.leadsService.findOne(id);
  }

  @Patch(':id/status')
  updateStatus(@Param('id') id: string, @Body() dto: UpdateLeadStatusDto) {
    return this.leadsService.updateStatus(id, dto);
  }

  @Post(':id/enroll')
  enrollInDefault(@Param('id') id: string) {
    return this.leadsService.enrollInDefault(id);
  }
}
