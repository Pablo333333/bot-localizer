import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { calendar, calendar_v3 } from '@googleapis/calendar';
import { JWT } from 'google-auth-library';
import * as fs from 'fs';
import * as path from 'path';
import {
  formatMadridSlotLabel,
  intervalsOverlap,
  isWithinBookingWindow,
  listFreeSlots,
  madridWallToUtc,
  MIN_LEAD_MS,
  parseSlotInput,
  SLOT_DURATION_MS,
  type BusyInterval,
  type CalendarSlot,
} from './calendar-slots';

@Injectable()
export class CalendarService {
  private readonly logger = new Logger(CalendarService.name);
  private calendarClient: calendar_v3.Calendar | null = null;
  private readonly calendarId: string;

  constructor(private configService: ConfigService) {
    this.calendarId = this.configService.get<string>('GOOGLE_CALENDAR_ID') || '';
    this.initCalendar();
  }

  private initCalendar() {
    try {
      let credentials: { client_email?: string; private_key?: string } | undefined;

      if (process.env.GOOGLE_CREDENTIALS_JSON) {
        try {
          credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON);
          this.logger.log(
            'Google Calendar: Usando credenciales desde variable de entorno',
          );
        } catch {
          this.logger.error(
            'Error al parsear GOOGLE_CREDENTIALS_JSON, usando fallback de archivo',
          );
        }
      }

      if (!credentials) {
        const credentialsPath = path.join(process.cwd(), 'google-credentials.json');
        credentials = JSON.parse(fs.readFileSync(credentialsPath, 'utf8'));
        this.logger.log('Google Calendar: Usando credenciales desde archivo físico');
      }

      if (!credentials?.client_email || !credentials.private_key) {
        throw new Error('Credenciales de Google Calendar no disponibles');
      }

      const auth = new JWT({
        email: credentials.client_email,
        key: credentials.private_key,
        scopes: ['https://www.googleapis.com/auth/calendar'],
      });

      this.calendarClient = calendar({ version: 'v3', auth });
      this.logger.log('Google Calendar Service inicializado correctamente');
    } catch (error) {
      this.calendarClient = null;
      this.logger.error(
        `Error al inicializar Google Calendar: ${(error as Error).message}`,
      );
    }
  }

  /** Etiquetas en español, para el flujo de WhatsApp. */
  async getAvailableSlots(now: Date = new Date()): Promise<string[]> {
    const slots = await this.listBookableSlots(now);
    return slots.map((slot) => slot.etiqueta);
  }

  async listBookableSlots(now: Date = new Date()): Promise<CalendarSlot[]> {
    if (!this.calendarClient || !this.calendarId) {
      this.logger.error('Google Calendar no está inicializado');
      return [];
    }
    const horizon = new Date(now.getTime() + 8 * 24 * 60 * 60 * 1000);
    try {
      const response = await this.calendarClient.events.list({
        calendarId: this.calendarId,
        timeMin: now.toISOString(),
        timeMax: horizon.toISOString(),
        singleEvents: true,
        orderBy: 'startTime',
      });
      return listFreeSlots({
        now,
        busy: this.busyIntervals(response.data.items || []),
      });
    } catch (error) {
      this.logger.error(
        `Error al consultar disponibilidad: ${(error as Error).message}`,
      );
      return [];
    }
  }

  /**
   * Inserta la cita en la hora indicada. Si el texto no es un hueco válido,
   * no crea un evento "ahora".
   */
  async bookAppointment(
    userPhone: string,
    slot: string,
    details: string,
    now: Date = new Date(),
  ): Promise<boolean> {
    const start = parseSlotInput(slot, now);
    if (!start) {
      this.logger.error(`Hueco de cita no interpretable: "${slot}"`);
      return false;
    }
    const booked = await this.bookCallSlot({
      start,
      phone: userPhone,
      motivo: details,
      now,
    });
    return booked.ok;
  }

  async bookCallSlot(input: {
    start: Date;
    phone: string;
    nombre?: string;
    motivo?: string;
    now?: Date;
  }): Promise<{ ok: boolean; etiqueta?: string; error?: string }> {
    if (!this.calendarClient || !this.calendarId) {
      return { ok: false, error: 'El calendario no está disponible.' };
    }
    const now = input.now ?? new Date();
    const start = input.start;
    if (
      start.getTime() < now.getTime() + MIN_LEAD_MS ||
      !isWithinBookingWindow(start)
    ) {
      return {
        ok: false,
        error: 'Ese hueco no se puede reservar. Consulta de nuevo y elige otro.',
      };
    }
    const end = new Date(start.getTime() + SLOT_DURATION_MS);
    const etiqueta = formatMadridSlotLabel(start);

    try {
      const existing = await this.calendarClient.events.list({
        calendarId: this.calendarId,
        timeMin: start.toISOString(),
        timeMax: end.toISOString(),
        singleEvents: true,
      });
      const busy = this.busyIntervals(existing.data.items || []);
      if (intervalsOverlap(start.getTime(), end.getTime(), busy)) {
        return {
          ok: false,
          error: 'Ese hueco acaba de ocuparse. Consulta la disponibilidad otra vez.',
        };
      }

      const who = input.nombre?.trim() || input.phone || 'sin teléfono';
      await this.calendarClient.events.insert({
        calendarId: this.calendarId,
        requestBody: {
          summary: `Llamada Localicer — ${who}`,
          description: [
            input.phone ? `Teléfono: ${input.phone}` : '',
            input.nombre ? `Nombre: ${input.nombre}` : '',
            input.motivo ? `Motivo: ${input.motivo}` : '',
          ]
            .filter(Boolean)
            .join('\n'),
          start: {
            dateTime: start.toISOString(),
            timeZone: 'Europe/Madrid',
          },
          end: {
            dateTime: end.toISOString(),
            timeZone: 'Europe/Madrid',
          },
        },
      });
      this.logger.log(
        `Cita registrada en ${this.calendarId} para ${input.phone || who} a las ${etiqueta}`,
      );
      return { ok: true, etiqueta };
    } catch (error) {
      const message = (error as Error).message;
      this.logger.error(`Error al insertar evento en Google Calendar: ${message}`);
      return { ok: false, error: 'No se pudo escribir en el calendario.' };
    }
  }

  private busyIntervals(events: calendar_v3.Schema$Event[]): BusyInterval[] {
    const intervals: BusyInterval[] = [];
    for (const event of events) {
      if (event.transparency === 'transparent' || event.status === 'cancelled') {
        continue;
      }
      if (event.start?.dateTime) {
        const startMs = new Date(event.start.dateTime).getTime();
        const endMs = new Date(
          event.end?.dateTime || event.start.dateTime,
        ).getTime();
        if (!Number.isNaN(startMs) && !Number.isNaN(endMs)) {
          intervals.push({ startMs, endMs });
        }
        continue;
      }
      if (event.start?.date) {
        const [year, month, day] = event.start.date.split('-').map(Number);
        const [endYear, endMonth, endDay] = (event.end?.date || event.start.date)
          .split('-')
          .map(Number);
        intervals.push({
          startMs: madridWallToUtc(year, month, day, 0, 0).getTime(),
          endMs: madridWallToUtc(endYear, endMonth, endDay, 0, 0).getTime(),
        });
      }
    }
    return intervals;
  }
}
