import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import Retell from 'retell-sdk';
import { SheetsService } from '../sheets/sheets.service';

const SHEET_NAME = 'Localizados';
const COL_LLAMADO_FP = 'Llamado FP';
const COL_CALL_ID = 'Call ID';
const COL_MARCA_TEMPORAL = 'Marca temporal';
const COL_FECHA_ACTUALIZACION = 'Fecha actualización';
const COL_TIPO_INMUEBLE = 'Tipo de inmueble';
const COL_DISPONIBILIDAD = 'Disponibilidad del local';
const STATUS_LLAMADO = 'SI';

const COL_C1_CON = 'Contacto1 con';
const COL_C1_TEL = 'Teléfonos de contacto';
const COL_C2_CON = 'Contacto2 con';
const COL_C2_TEL = 'Telefono2';
const COL_C3_CON = 'Contacto3 con';
const COL_C3_TEL = 'Telefono3';

const MAX_DAILY_CALLS = 5;
const DELAY_BETWEEN_CALLS_MS = 90_000; // 1.5 minutos entre llamadas
const TIMEZONE = 'Europe/Madrid';
const BUSINESS_START_MINUTES = 10 * 60; // 10:00
const BUSINESS_END_MINUTES = 20 * 60 + 30; // 20:30

@Injectable()
export class OutboundService {
  private readonly logger = new Logger(OutboundService.name);
  private readonly retell: Retell;
  private readonly agentId: string;
  private readonly fromNumber: string;
  private isRunning = false;

  constructor(
    private readonly sheetsService: SheetsService,
    private readonly configService: ConfigService,
  ) {
    this.retell = new Retell({
      apiKey: this.configService.getOrThrow<string>('RETELL_API_KEY'),
    });
    this.agentId = this.configService.getOrThrow<string>('RETELL_OUTBOUND_AGENT_ID');
    this.fromNumber = this.configService.getOrThrow<string>('RETELL_FROM_NUMBER');
  }

  @Cron(CronExpression.EVERY_5_MINUTES)
  async checkPendingCalls(): Promise<void> {
    if (this.isRunning) {
      this.logger.log('[OutboundService] Ejecución anterior aún en curso. Se omite este ciclo.');
      return;
    }

    this.isRunning = true;
    try {
      await this.processPendingCalls();
    } finally {
      this.isRunning = false;
    }
  }

  private async processPendingCalls(): Promise<void> {
    this.logger.log('Iniciando control de llamadas salientes...');

    if (!this.isWithinBusinessHours()) {
      this.logger.log(
        `[OutboundService] Fuera de horario laboral (L-V 10:00-20:30 ${TIMEZONE}). No se lanzan llamadas.`,
      );
      return;
    }

    const doc = this.sheetsService.getDoc();
    const sheet = doc.sheetsByTitle[SHEET_NAME];

    if (!sheet) {
      this.logger.error(
        `[OutboundService] No se encontró la pestaña "${SHEET_NAME}". Abortando.`,
      );
      return;
    }

    await sheet.loadHeaderRow();
    const rows = await sheet.getRows();

    const callsToday = this.countCallsToday(rows);
    if (callsToday >= MAX_DAILY_CALLS) {
      this.logger.log(
        `[OutboundService] Límite diario alcanzado (${callsToday}/${MAX_DAILY_CALLS}). No se realizarán más llamadas hoy.`,
      );
      return;
    }

    let remainingToday = MAX_DAILY_CALLS - callsToday;
    this.logger.log(
      `Cupo diario: ${callsToday}/${MAX_DAILY_CALLS} realizadas. Disponibles ahora: ${remainingToday}`,
    );

    // Pendientes: sin "SI" en Llamado FP, ordenados por Marca temporal ascendente
    const pendingRows = rows
      .filter((row) => {
        const llamadoFp = row.get(COL_LLAMADO_FP)?.toString().trim().toUpperCase();
        return llamadoFp !== STATUS_LLAMADO && llamadoFp !== 'SÍ';
      })
      .sort((a, b) => {
        const dateA = this.parseMarcaTemporal(a.get(COL_MARCA_TEMPORAL)?.toString());
        const dateB = this.parseMarcaTemporal(b.get(COL_MARCA_TEMPORAL)?.toString());
        return dateA - dateB;
      });

    this.logger.log(
      `[OutboundService] ${pendingRows.length} filas pendientes en "${SHEET_NAME}" (ordenadas por Marca temporal ASC).`,
    );

    let callsLaunchedThisRun = 0;

    for (const row of pendingRows) {
      if (remainingToday <= 0) break;

      const rawPhone = this.getBestPhone(row);
      if (!rawPhone) continue;

      const phone = this.formatE164Spain(rawPhone);
      const tipoInmueble = row.get(COL_TIPO_INMUEBLE)?.toString().trim() || '';
      const disponibilidad = row.get(COL_DISPONIBILIDAD)?.toString().trim() || '';

      try {
        if (callsLaunchedThisRun > 0) {
          this.logger.log(
            `[OutboundService] Esperando ${DELAY_BETWEEN_CALLS_MS / 1000}s antes de la siguiente llamada...`,
          );
          await this.delay(DELAY_BETWEEN_CALLS_MS);

          // Revalidar horario tras el retardo (p. ej. si ya pasaron las 20:30)
          if (!this.isWithinBusinessHours()) {
            this.logger.log(
              '[OutboundService] Se salió del horario laboral durante el retardo. Deteniendo lote.',
            );
            break;
          }
        }

        const call = await this.retell.call.createPhoneCall({
          from_number: this.fromNumber,
          to_number: phone,
          override_agent_id: this.agentId,
          retell_llm_dynamic_variables: {
            tipo_inmueble: tipoInmueble,
            disponibilidad: disponibilidad,
          },
        });

        // Anti-loop: marcar como llamado de inmediato
        row.set(COL_LLAMADO_FP, STATUS_LLAMADO);
        row.set(COL_CALL_ID, call.call_id);
        row.set(COL_FECHA_ACTUALIZACION, this.formatMadridDateTime(new Date()));
        await row.save();

        this.logger.log(
          `Llamada iniciada — número: ${phone} | call_id: ${call.call_id}`,
        );
        remainingToday--;
        callsLaunchedThisRun++;
      } catch (err) {
        this.logger.error(
          `Error al llamar al número ${phone}: ${(err as Error).message}`,
        );
      }
    }

    this.logger.log(
      `[OutboundService] Ciclo terminado. Llamadas lanzadas en este run: ${callsLaunchedThisRun}`,
    );
  }

  /**
   * L-V entre 10:00 y 20:30 (Europe/Madrid).
   */
  private isWithinBusinessHours(now: Date = new Date()): boolean {
    const madrid = this.getMadridParts(now);
    // 1=Lunes ... 5=Viernes; 6=Sábado; 0=Domingo
    if (madrid.weekday === 0 || madrid.weekday === 6) {
      return false;
    }

    const minutes = madrid.hour * 60 + madrid.minute;
    return minutes >= BUSINESS_START_MINUTES && minutes <= BUSINESS_END_MINUTES;
  }

  private getMadridParts(date: Date): {
    weekday: number;
    hour: number;
    minute: number;
    day: number;
    month: number;
    year: number;
  } {
    const formatter = new Intl.DateTimeFormat('en-GB', {
      timeZone: TIMEZONE,
      weekday: 'short',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    const parts = Object.fromEntries(
      formatter.formatToParts(date).map((p) => [p.type, p.value]),
    );

    const weekdayMap: Record<string, number> = {
      Sun: 0,
      Mon: 1,
      Tue: 2,
      Wed: 3,
      Thu: 4,
      Fri: 5,
      Sat: 6,
    };

    return {
      weekday: weekdayMap[parts.weekday] ?? 0,
      hour: Number(parts.hour),
      minute: Number(parts.minute),
      day: Number(parts.day),
      month: Number(parts.month),
      year: Number(parts.year),
    };
  }

  /**
   * Cuenta filas ya marcadas como llamadas hoy (Fecha actualización en Madrid).
   */
  private countCallsToday(rows: any[]): number {
    const today = this.getMadridParts(new Date());
    const todayKey = `${today.day}/${today.month}/${today.year}`;

    return rows.filter((row) => {
      const llamadoFp = row.get(COL_LLAMADO_FP)?.toString().trim().toUpperCase();
      if (llamadoFp !== STATUS_LLAMADO && llamadoFp !== 'SÍ') return false;

      const fecha = row.get(COL_FECHA_ACTUALIZACION)?.toString().trim() || '';
      if (!fecha) return false;

      // Formatos esperados: "14/07/2026 12:05:00" o "14/7/2026 ..."
      const datePart = fecha.split(/\s+/)[0];
      const match = datePart.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
      if (!match) return false;

      const key = `${Number(match[1])}/${Number(match[2])}/${Number(match[3])}`;
      return key === todayKey;
    }).length;
  }

  /**
   * Parsea "Marca temporal" a timestamp; valores inválidos al final (Infinity).
   */
  private parseMarcaTemporal(raw: string | undefined | null): number {
    if (!raw) return Number.POSITIVE_INFINITY;

    const cleaned = raw.trim().replace(',', '');
    // d/M/yyyy H:mm:ss | dd/MM/yyyy HH:mm:ss | d/M/yyyy
    const match = cleaned.match(
      /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/,
    );

    if (match) {
      const [, d, m, y, hh = '0', mm = '0', ss = '0'] = match;
      const ts = Date.UTC(
        Number(y),
        Number(m) - 1,
        Number(d),
        Number(hh),
        Number(mm),
        Number(ss),
      );
      return Number.isNaN(ts) ? Number.POSITIVE_INFINITY : ts;
    }

    const fallback = Date.parse(cleaned);
    return Number.isNaN(fallback) ? Number.POSITIVE_INFINITY : fallback;
  }

  private formatMadridDateTime(date: Date): string {
    const p = this.getMadridParts(date);
    const pad = (n: number) => n.toString().padStart(2, '0');
    // Segundos no vienen en getMadridParts; los tomamos del instante local formateado
    const seconds = Number(
      new Intl.DateTimeFormat('en-GB', {
        timeZone: TIMEZONE,
        second: '2-digit',
        hour12: false,
      }).format(date),
    );
    return `${p.day}/${pad(p.month)}/${p.year} ${pad(p.hour)}:${pad(p.minute)}:${pad(seconds)}`;
  }

  private formatE164Spain(rawPhone: string): string {
    let phone = rawPhone.replace(/\s+/g, '');
    if (phone.startsWith('+34')) return phone;
    if (phone.startsWith('34')) return '+' + phone;
    return '+34' + phone;
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Prioridad de teléfono:
   * 1. Particular
   * 2. Indeterminado o vacío
   * 3. Si todos son Profesional, se salta la fila.
   */
  private getBestPhone(row: any): string | null {
    const contacts = [
      {
        role: row.get(COL_C1_CON)?.toString().trim(),
        phone: row.get(COL_C1_TEL)?.toString().trim(),
      },
      {
        role: row.get(COL_C2_CON)?.toString().trim(),
        phone: row.get(COL_C2_TEL)?.toString().trim(),
      },
      {
        role: row.get(COL_C3_CON)?.toString().trim(),
        phone: row.get(COL_C3_TEL)?.toString().trim(),
      },
    ];

    const validContacts = contacts.filter((c) => c.phone);
    if (validContacts.length === 0) return null;

    const particular = validContacts.find((c) => c.role === 'Particular');
    if (particular) return particular.phone;

    const indeterminado = validContacts.find(
      (c) => !c.role || c.role === 'Indeterminado',
    );
    if (indeterminado) return indeterminado.phone;

    const allProfesional = validContacts.every((c) => c.role === 'Profesional');
    if (allProfesional) return null;

    return validContacts[0].phone;
  }
}
