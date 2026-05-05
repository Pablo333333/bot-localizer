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
      const credentialsPath = path.join(process.cwd(), 'google-credentials.json');
      const credentials = JSON.parse(fs.readFileSync(credentialsPath, 'utf8'));

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
   * Consulta disponibilidad (Placeholder mejorado)
   * En el futuro se integrará con freebusy de Google Calendar API
   */
  async getAvailableSlots(): Promise<string[]> {
    this.logger.log(`Consultando disponibilidad para el calendario: ${this.calendarId}`);
    // Simulamos disponibilidad para mañana
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const dateStr = tomorrow.toLocaleDateString('es-ES');
    
    return [
      `${dateStr} a las 10:00`,
      `${dateStr} a las 16:00`
    ];
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
