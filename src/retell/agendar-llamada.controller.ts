import {
  Body,
  Controller,
  Headers,
  Logger,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CalendarService } from '../v2/calendar.service';
import { handleAgendarLlamada } from './agendar-llamada';
import { RetellWebhookGuard } from './retell-webhook.guard';

@Controller('webhooks/retell')
@UseGuards(RetellWebhookGuard)
export class AgendarLlamadaController {
  private readonly logger = new Logger(AgendarLlamadaController.name);

  constructor(private readonly calendar: CalendarService) {}

  @Post('agendar-llamada')
  async agendar(
    @Body() body: Record<string, unknown>,
    @Headers('x-localicer-tool-key') _toolKey?: string,
  ): Promise<Record<string, unknown>> {
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
        error:
          'No se pudo consultar el calendario. Discúlpate y no confirmes cita.',
      };
    }
  }
}
