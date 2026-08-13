import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { Channel } from '../../enums';

export class CreateSequenceStepDto {
  @IsInt()
  @Min(1)
  order: number;

  @IsEnum(Channel)
  channel: Channel;

  @IsInt()
  @Min(0)
  delayMinutes: number;

  @IsString()
  @IsNotEmpty()
  templateKey: string;

  @IsOptional()
  @IsObject()
  templatePayload?: Record<string, unknown>;

  @IsOptional()
  @IsInt()
  @Min(0)
  maxRetries?: number;
}

export class CreateSequenceDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateSequenceStepDto)
  steps: CreateSequenceStepDto[];
}
