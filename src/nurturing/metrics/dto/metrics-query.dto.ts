import { IsOptional, IsString } from 'class-validator';

export class MetricsQueryDto {
  @IsOptional()
  @IsString()
  from?: string;

  @IsOptional()
  @IsString()
  to?: string;
}

/** Forma de GET /nurturing/metrics/summary */
export interface MetricsSummaryResponse {
  leadsGenerated: number;
  leadsByStatus: {
    nuevo: number;
    interesado: number;
    cita_programada: number;
    cerrado: number;
  };
  communicationsSent: number;
  communicationsByChannel: {
    whatsapp: number;
    email: number;
    llamada: number;
    sms: number;
  };
  /** cita_programada / total en el periodo */
  visitScheduledRate: number;
  /** cerrado / total en el periodo */
  closedRate: number;
  executionErrors: number;
  recentErrors: Array<{
    id: string;
    message: string;
    code: string | null;
    createdAt: Date;
    stepRunId: string | null;
  }>;
}
