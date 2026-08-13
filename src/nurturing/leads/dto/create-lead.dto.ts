import {
  IsBoolean,
  IsEmail,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { LeadStatus } from '../../enums';

export class CreateLeadDto {
  @IsString()
  @IsNotEmpty()
  phone: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  source?: string;

  @IsOptional()
  @IsEnum(LeadStatus)
  status?: LeadStatus;

  @IsOptional()
  @IsInt()
  @Min(1)
  sheetsRowNumber?: number;

  @IsOptional()
  @IsString()
  externalRef?: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;

  /** Si true, enrolla en la secuencia default tras crear */
  @IsOptional()
  @IsBoolean()
  enrollInDefault?: boolean;
}
