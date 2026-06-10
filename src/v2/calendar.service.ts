import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { google, calendar_v3 } from 'googleapis';
import { JWT } from 'google-auth-library';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class CalendarService {
  private readonly logger = new Logger(CalendarService.name);
  private calendar: calendar_v3.Calendar;
  private readonly calendarId: string;

  constructor(private configService: ConfigService) {
    this.calendarId = this.configService.get<string>('GOOGLE_CALENDAR_ID')!;
    this.initCalendar();
  }

  private initCalendar() {
    try {
      let credentials: any;

      if (process.env.GOOGLE_CREDENTIALS_JSON) {
        try {
          credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON);
          this.logger.log(
            'Google Calendar: Usando credenciales desde variable de entorno',
          );
        } catch (err) {
          this.logger.error(
            'Error al parsear GOOGLE_CREDENTIALS_JSON, usando fallback de archivo',
          );
        }
      }

      if (!credentials) {
        const credentialsPath = path.join(
          process.cwd(),
          'google-credentials.json',
        );
        credentials = JSON.parse(fs.readFileSync(credentialsPath, 'utf8'));
        this.logger.log(
          'Google Calendar: Usando credenciales desde archivo físico',
        );
      }

      const auth = new JWT({
        email: credentials.client_email,
        key: credentials.private_key,
        scopes: ['https://www.googleapis.com/auth/calendar'],
      });

      this.calendar = google.calendar({ version: 'v3', auth });
      this.logger.log('Google Calendar Service inicializado correctamente');
    } catch (error) {
      this.logger.error(`Error al inicializar Google Calendar: ${error.message}`);
    }
  }

  /**
   * Consulta disponibilidad real en Google Calendar
   * Busca huecos libres entre 9:00 y 18:00 para los próximos 3 días
   */
  async getAvailableSlots(): Promise<string[]> {
    this.logger.log(`Consultando disponibilidad real para el calendario: ${this.calendarId}`);
    
    try {
      const now = new Date();
      const threeDaysLater = new Date();
      threeDaysLater.setDate(now.getDate() + 3);

      const response = await this.calendar.events.list({
        calendarId: this.calendarId,
        timeMin: now.toISOString(),
        timeMax: threeDaysLater.toISOString(),
        singleEvents: true,
        orderBy: 'startTime',
      });

      const events = response.data.items || [];
      const slots: string[] = [];

      // Definimos el horario comercial: 9:00 a 18:00
      const startHour = 9;
      const endHour = 18;

      for (let i = 0; i <= 3; i++) {
        const day = new Date();
        day.setDate(now.getDate() + i);
        day.setHours(0, 0, 0, 0);

        // Si es hoy y ya pasaron las 18:00, saltamos
        if (i === 0 && now.getHours() >= endHour) continue;

        const dateStr = day.toLocaleDateString('es-ES');

        // Generamos huecos de 1 hora entre las 9 y las 17 (para terminar a las 18)
        for (let hour = startHour; hour < endHour; hour++) {
          const slotStart = new Date(day);
          slotStart.setHours(hour, 0, 0, 0);

          // Si es hoy, solo mostramos huecos futuros (con 2 horas de margen)
          if (i === 0 && slotStart.getTime() < now.getTime() + 2 * 3600000) continue;

          const slotEnd = new Date(slotStart);
          slotEnd.setHours(hour + 1);

          // Verificamos si este hueco choca con algún evento
          const isBusy = events.some(event => {
            const eventStart = new Date(event.start?.dateTime || event.start?.date || '');
            const eventEnd = new Date(event.end?.dateTime || event.end?.date || '');
            return (slotStart < eventEnd && slotEnd > eventStart);
          });

          if (!isBusy) {
            slots.push(`${dateStr} a las ${hour}:00`);
          }

          // Limitamos a 6 huecos en total para no saturar el chat
          if (slots.length >= 6) return slots;
        }
      }

      return slots;
    } catch (error) {
      this.logger.error(`Error al consultar disponibilidad: ${error.message}`);
      return ['Mañana a las 10:00', 'Mañana a las 16:00']; // Fallback
    }
  }

  /**
   * Inserta un evento en el calendario usando la API real
   */
  async bookAppointment(userPhone: string, slot: string, details: string): Promise<boolean> {
    this.logger.log(`Agendando cita en ${this.calendarId} para ${userPhone} en el hueco: ${slot}`);
    
    try {
      // Nota: En una integración real, 'slot' debería ser un objeto Date. 
      // Aquí simplificamos para el flujo de la Fase 2.
      const event = {
        summary: `Visita Localicer - ${userPhone}`,
        description: details,
        start: {
          dateTime: new Date().toISOString(), // Fallback por ahora
          timeZone: this.configService.get('TIMEZONE') || 'Europe/Madrid',
        },
        end: {
          dateTime: new Date(Date.now() + 3600000).toISOString(),
          timeZone: this.configService.get('TIMEZONE') || 'Europe/Madrid',
        },
      };

      await this.calendar.events.insert({
        calendarId: this.calendarId,
        requestBody: event,
      });

      return true;
    } catch (error) {
      this.logger.error(`Error al insertar evento en Google Calendar: ${error.message}`);
      return false;
    }
  }
}
