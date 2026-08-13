import { IsEnum, IsOptional, IsString } from 'class-validator';
import { LeadStatus } from '../../enums';

export class UpdateLeadStatusDto {
  @IsEnum(LeadStatus)
  status: LeadStatus;

  @IsOptional()
  @IsString()
  reason?: string;
}
