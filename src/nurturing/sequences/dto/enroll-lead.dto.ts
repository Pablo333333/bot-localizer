import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class EnrollLeadDto {
  @IsString()
  @IsNotEmpty()
  leadId: string;

  /** Si se omite, usa la secuencia marcada como isDefault */
  @IsOptional()
  @IsString()
  sequenceId?: string;
}

export class CancelEnrollmentDto {
  @IsOptional()
  @IsString()
  reason?: string;
}
