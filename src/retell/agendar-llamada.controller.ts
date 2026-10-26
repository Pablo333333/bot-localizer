import {
  Body,
  Controller,
  Headers,
  Logger,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CalendarService } from '../v2/calendar.service';
import { handleAgendarLlamada } from './agendar-llamada';

@Controller('webhooks/retell')
export class AgendarLlamadaController {
  private readonly logger = new Logger(AgendarLlamadaController.name);

  constructor(
    private readonly calendar: CalendarService,
    private readonly config: ConfigService,
  ) {}

  @Post('agendar-llamada')
  async agendar(
    @Body() body: Record<string, unknown>,
    @Headers('x-localicer-tool-key') toolKey?: string,
  ): Promise<Record<string, unknown>> {
    const secret = this.config.get<string>('RETELL_TOOL_SECRET')?.trim();
    if (secret && toolKey !== secret) {
      throw new UnauthorizedException('Herramienta no autorizada');
    }

    const call = (body?.call || {}) as { call_id?: string };
    this.logger.log(
      `[AGENDAR_LLAMADA] call=${call.call_id || 'n/a'} accion=${
        ((body?.args || body) as { accion?: string })?.accion || '?'
      }`,
    );

    try {
      return await handleAgendarLlamada(body, {
        listSlots: (now) => this.calendar.listBookableSlots(now),
        bookCall: (input) => this.calendar.bookCallSlot(input),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`[AGENDAR_LLAMADA] ${message}`);
      return {
        ok: false,
        reservada: false,
        error: 'No se pudo consultar el calendario. Discúlpate y no confirmes cita.',
      };
    }
  }
}
