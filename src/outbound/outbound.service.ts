import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import Retell from 'retell-sdk';
import { SheetsService } from '../sheets/sheets.service';

const SHEET_NAME = 'Localizados';
const COL_LLAMADO = 'Llamado';
const COL_CALL_ID = 'Call ID';
const COL_MARCA_TEMPORAL = 'Marca temporal';
const COL_FECHA_ACTUALIZACION = 'Fecha actualizacion';
const COL_TIPO_INMUEBLE = 'Tipo de inmueble';
const COL_DISPONIBILIDAD = 'Disponibilidad del local';

const MARKED_STATUSES = new Set(['SI', 'SÍ', 'INTENTADO', 'YES', 'TRUE']);

// Teléfonos y roles exactos de la pestaña Localizados
const COL_C1_ROL = 'Contacto1 por';
const COL_C1_TEL = 'Telefono1';
const COL_C2_ROL = 'Contacto2 por';
const COL_C2_TEL = 'Telefono2';
const COL_C3_ROL = 'Contacto3 por';
const COL_C3_TEL = 'Telefono3';

const MAX_DAILY_CALLS = 5;
const DELAY_BETWEEN_CALLS_MS = 90_000;
const ANTI_REPEAT_MS = 12 * 60 * 60 * 1000;
const TIMEZONE = 'Europe/Madrid';
const BUSINESS_START_MINUTES = 10 * 60;
const BUSINESS_END_MINUTES = 20 * 60 + 30;

@Injectable()
export class OutboundService {
  private readonly logger = new Logger(OutboundService.name);
  private readonly retell: Retell;
  private readonly agentId: string;
  private readonly fromNumber: string;
  private isRunning = false;

  /** Fuente de verdad del límite diario: intentos de esta sesión/día Madrid. */
  private readonly attemptedPhonesToday = new Set<string>();
  private readonly lastAttemptByPhone = new Map<string, number>();
  private dailyAttemptCount = 0;
  private dailyAttemptDateKey = '';

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
      this.logger.log(
        '[OutboundService] Descartado ciclo: ejecución anterior aún en curso.',
      );
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
    const madridNow = this.getMadridParts(new Date());
    this.logger.log(
      `[OutboundService] Inicio ciclo. Hora Madrid: ${madridNow.day}/${madridNow.month}/${madridNow.year} ${String(madridNow.hour).padStart(2, '0')}:${String(madridNow.minute).padStart(2, '0')} (weekday=${madridNow.weekday})`,
    );

    if (!this.isWithinBusinessHours()) {
      this.logger.log(
        `[OutboundService] Descartado ciclo: Fuera de horario laboral (L-V 10:00-20:30 ${TIMEZONE}).`,
      );
      return;
    }

    this.rotateDailyCountersIfNeeded();

    const doc = this.sheetsService.getDoc();
    const sheet = doc.sheetsByTitle[SHEET_NAME];

    if (!sheet) {
      this.logger.error(
        `[OutboundService] Descartado ciclo: no existe la pestaña "${SHEET_NAME}".`,
      );
      return;
    }

    await sheet.loadHeaderRow();
    const headers = sheet.headerValues || [];
    this.logger.log(
      `[OutboundService] Cabeceras clave → Llamado: ${headers.includes(COL_LLAMADO) ? 'OK' : 'FALTA'} | Telefono1: ${headers.includes(COL_C1_TEL) ? 'OK' : 'FALTA'} | Contacto1 por: ${headers.includes(COL_C1_ROL) ? 'OK' : 'FALTA'} | Call ID: ${headers.includes(COL_CALL_ID) ? 'OK' : 'FALTA'} | Marca temporal: ${headers.includes(COL_MARCA_TEMPORAL) ? 'OK' : 'FALTA'}`,
    );

    const rows = await sheet.getRows();
    this.logger.log(`[OutboundService] Filas leídas en "${SHEET_NAME}": ${rows.length}`);

    // Límite diario: SOLO memoria (no bloquear por formatos raros de Fecha actualización)
    const attemptsToday = this.dailyAttemptCount;
    this.logger.log(
      `[OutboundService] Cupo diario (memoria): ${attemptsToday}/${MAX_DAILY_CALLS}. Set teléfonos hoy: ${this.attemptedPhonesToday.size}`,
    );

    if (attemptsToday >= MAX_DAILY_CALLS) {
      this.logger.log(
        `[OutboundService] Descartado ciclo: Límite alcanzado (${attemptsToday}/${MAX_DAILY_CALLS}).`,
      );
      return;
    }

    let remainingToday = MAX_DAILY_CALLS - attemptsToday;

    // Clasificar filas con motivo explícito de descarte
    type Candidate = { row: any; rowNumber: number; phone: string; phoneKey: string; marcaTs: number };
    const candidates: Candidate[] = [];
    let discardedCount = 0;

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNumber = i + 2; // fila 1 = headers
      const reason = this.getDiscardReason(row, rowNumber);

      if (reason) {
        discardedCount++;
        this.logger.log(
          `[OutboundService] Fila ${rowNumber} descartada: ${reason}`,
        );
        continue;
      }

      const rawPhone = this.getBestPhone(row)!;
      const phone = this.formatE164Spain(rawPhone);
      candidates.push({
        row,
        rowNumber,
        phone,
        phoneKey: this.normalizePhoneKey(phone),
        marcaTs: this.parseMarcaTemporal(row.get(COL_MARCA_TEMPORAL)?.toString()),
      });
    }

    candidates.sort((a, b) => a.marcaTs - b.marcaTs);

    this.logger.log(
      `[OutboundService] Resumen selección: ${candidates.length} candidatas | ${discardedCount} descartadas | cupo restante ${remainingToday}`,
    );

    if (candidates.length === 0) {
      this.logger.log(
        '[OutboundService] Descartado ciclo: ninguna fila candidata tras filtros (ver logs de descarte por fila).',
      );
      return;
    }

    let callsLaunchedThisRun = 0;

    for (const candidate of candidates) {
      if (remainingToday <= 0) {
        this.logger.log(
          `[OutboundService] Fila ${candidate.rowNumber} descartada: Límite alcanzado (${this.dailyAttemptCount}/${MAX_DAILY_CALLS}).`,
        );
        break;
      }

      const { row, rowNumber, phone, phoneKey } = candidate;

      // Re-check memoria (por si otra fila del mismo lote ya usó el número)
      if (this.attemptedPhonesToday.has(phoneKey)) {
        this.logger.log(
          `[OutboundService] Fila ${rowNumber} descartada: Teléfono repetido hoy (memoria) → ${phone}`,
        );
        continue;
      }

      const lastTs = this.lastAttemptByPhone.get(phoneKey);
      if (lastTs && Date.now() - lastTs < ANTI_REPEAT_MS) {
        this.logger.log(
          `[OutboundService] Fila ${rowNumber} descartada: Teléfono repetido en últimas 12h (memoria) → ${phone}`,
        );
        continue;
      }

      const tipoInmueble = row.get(COL_TIPO_INMUEBLE)?.toString().trim() || '';
      const disponibilidad = row.get(COL_DISPONIBILIDAD)?.toString().trim() || '';
      const nowLabel = this.formatMadridDateTime(new Date());

      try {
        if (callsLaunchedThisRun > 0) {
          this.logger.log(
            `[OutboundService] Esperando ${DELAY_BETWEEN_CALLS_MS / 1000}s antes del siguiente intento...`,
          );
          await this.delay(DELAY_BETWEEN_CALLS_MS);

          if (!this.isWithinBusinessHours()) {
            this.logger.log(
              `[OutboundService] Fila ${rowNumber} descartada: Fuera de horario (tras retardo). Deteniendo lote.`,
            );
            break;
          }
        }

        this.logger.log(
          `[OutboundService] Fila ${rowNumber} ACEPTADA → marcando Llamado=SI y disparando Retell (${phone})`,
        );

        // Marcar ANTES de Retell
        row.set(COL_LLAMADO, 'SI');
        row.set(COL_FECHA_ACTUALIZACION, nowLabel);
        await row.save();

        this.rememberAttempt(phoneKey);
        this.dailyAttemptCount++;
        remainingToday--;
        callsLaunchedThisRun++;

        const call = await this.retell.call.createPhoneCall({
          from_number: this.fromNumber,
          to_number: phone,
          override_agent_id: this.agentId,
          retell_llm_dynamic_variables: {
            tipo_inmueble: tipoInmueble,
            disponibilidad: disponibilidad,
          },
        });

        row.set(COL_CALL_ID, call.call_id);
        await row.save();

        this.logger.log(
          `[OutboundService] Fila ${rowNumber} OK — call_id=${call.call_id} | intentos hoy=${this.dailyAttemptCount}/${MAX_DAILY_CALLS}`,
        );
      } catch (err) {
        this.logger.error(
          `[OutboundService] Fila ${rowNumber} error Retell (ya marcada SI, no se reintenta): ${(err as Error).message}`,
        );
      }
    }

    this.logger.log(
      `[OutboundService] Ciclo terminado. Intentos en este run: ${callsLaunchedThisRun}. Total día (memoria): ${this.dailyAttemptCount}/${MAX_DAILY_CALLS}`,
    );
  }

  /**
   * Devuelve el motivo de descarte, o null si la fila es candidata.
   */
  private getDiscardReason(row: any, rowNumber: number): string | null {
    const llamadoRaw = row.get(COL_LLAMADO)?.toString().trim() || '';
    const llamado = llamadoRaw.toUpperCase();
    if (MARKED_STATUSES.has(llamado)) {
      return `Llamado ya marcado ("${llamadoRaw}")`;
    }

    const callId = row.get(COL_CALL_ID)?.toString().trim();
    if (callId) {
      return `Call ID ya presente ("${callId}")`;
    }

    // Anti-repetición 12h solo si parseamos bien la fecha; si el formato es desconocido, NO bloqueamos
    const fechaRaw = row.get(COL_FECHA_ACTUALIZACION)?.toString().trim() || '';
    if (fechaRaw) {
      const ts = this.parseFlexibleDateTime(fechaRaw);
      if (ts !== null && Date.now() - ts < ANTI_REPEAT_MS) {
        return `Fecha actualización reciente (<12h): "${fechaRaw}"`;
      }
      if (ts === null) {
        this.logger.debug(
          `[OutboundService] Fila ${rowNumber}: Fecha actualización con formato no parseable ("${fechaRaw}"); se ignora para anti-12h.`,
        );
      }
    }

    const phoneResult = this.getBestPhoneWithReason(row);
    if (!phoneResult.phone) {
      return phoneResult.reason || 'Sin teléfono válido';
    }

    const phone = this.formatE164Spain(phoneResult.phone);
    const phoneKey = this.normalizePhoneKey(phone);

    if (this.attemptedPhonesToday.has(phoneKey)) {
      return `Teléfono repetido hoy (memoria) → ${phone}`;
    }

    const lastTs = this.lastAttemptByPhone.get(phoneKey);
    if (lastTs && Date.now() - lastTs < ANTI_REPEAT_MS) {
      return `Teléfono repetido en últimas 12h (memoria) → ${phone}`;
    }

    return null;
  }

  private getBestPhoneWithReason(row: any): { phone: string | null; reason?: string } {
    const contacts = [
      {
        label: 'Telefono1/Contacto1 por',
        role: row.get(COL_C1_ROL)?.toString().trim(),
        phone: row.get(COL_C1_TEL)?.toString().trim(),
      },
      {
        label: 'Telefono2/Contacto2 por',
        role: row.get(COL_C2_ROL)?.toString().trim(),
        phone: row.get(COL_C2_TEL)?.toString().trim(),
      },
      {
        label: 'Telefono3/Contacto3 por',
        role: row.get(COL_C3_ROL)?.toString().trim(),
        phone: row.get(COL_C3_TEL)?.toString().trim(),
      },
    ];

    const validContacts = contacts.filter((c) => c.phone);
    if (validContacts.length === 0) {
      return { phone: null, reason: 'Sin teléfono en Telefono1/Telefono2/Telefono3' };
    }

    // Prioridad: Particular → Indeterminado/vacío → omitir si todos Profesional
    const particular = validContacts.find(
      (c) => (c.role || '').toLowerCase() === 'particular',
    );
    if (particular) return { phone: particular.phone };

    const indeterminado = validContacts.find((c) => {
      const role = (c.role || '').trim().toLowerCase();
      return !role || role === 'indeterminado';
    });
    if (indeterminado) return { phone: indeterminado.phone };

    if (
      validContacts.every(
        (c) => (c.role || '').trim().toLowerCase() === 'profesional',
      )
    ) {
      return {
        phone: null,
        reason: `Solo contactos Profesional (${validContacts
          .map((c) => `${c.label}="${c.role}"`)
          .join(', ')})`,
      };
    }

    return { phone: validContacts[0].phone };
  }

  private rememberAttempt(phoneKey: string): void {
    this.rotateDailyCountersIfNeeded();
    this.attemptedPhonesToday.add(phoneKey);
    this.lastAttemptByPhone.set(phoneKey, Date.now());
  }

  private rotateDailyCountersIfNeeded(): void {
    const todayKey = this.getMadridDateKey(new Date());
    if (this.dailyAttemptDateKey !== todayKey) {
      this.logger.log(
        `[OutboundService] Nuevo día Madrid (${todayKey}). Reset contador/Set en memoria.`,
      );
      this.dailyAttemptDateKey = todayKey;
      this.dailyAttemptCount = 0;
      this.attemptedPhonesToday.clear();
    }
  }

  private getMadridDateKey(date: Date): string {
    const p = this.getMadridParts(date);
    const pad = (n: number) => n.toString().padStart(2, '0');
    return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
  }

  private normalizePhoneKey(phone: string): string {
    return phone.replace(/\D/g, '');
  }

  /**
   * Parsea fechas flexibles: DD/MM/YYYY, YYYY/MM/DD, YYYY-MM-DD, con o sin hora.
   * Devuelve timestamp o null si no se puede interpretar (NO bloquea el ciclo).
   */
  private parseFlexibleDateTime(raw: string): number | null {
    const cleaned = raw.trim().replace(',', ' ').replace(/\s+/g, ' ');

    // YYYY-MM-DD[ HH:mm[:ss]] o YYYY/MM/DD[...]
    let match = cleaned.match(
      /^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/,
    );
    if (match) {
      const [, y, m, d, hh = '0', mm = '0', ss = '0'] = match;
      return this.toLocalTs(+y, +m, +d, +hh, +mm, +ss);
    }

    // DD/MM/YYYY[ HH:mm[:ss]] o DD-MM-YYYY
    match = cleaned.match(
      /^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/,
    );
    if (match) {
      const [, d, m, y, hh = '0', mm = '0', ss = '0'] = match;
      return this.toLocalTs(+y, +m, +d, +hh, +mm, +ss);
    }

    // Serial Excel / número (días desde 1899-12-30)
    if (/^\d+(\.\d+)?$/.test(cleaned)) {
      const serial = Number(cleaned);
      if (serial > 20000 && serial < 100000) {
        const excelEpoch = Date.UTC(1899, 11, 30);
        return excelEpoch + serial * 86400000;
      }
    }

    const fallback = Date.parse(cleaned);
    return Number.isNaN(fallback) ? null : fallback;
  }

  private toLocalTs(
    y: number,
    m: number,
    d: number,
    hh: number,
    mm: number,
    ss: number,
  ): number | null {
    const ts = new Date(y, m - 1, d, hh, mm, ss).getTime();
    return Number.isNaN(ts) ? null : ts;
  }

  private isWithinBusinessHours(now: Date = new Date()): boolean {
    const madrid = this.getMadridParts(now);
    if (madrid.weekday === 0 || madrid.weekday === 6) return false;
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

  private parseMarcaTemporal(raw: string | undefined | null): number {
    if (!raw) return Number.POSITIVE_INFINITY;
    const ts = this.parseFlexibleDateTime(raw);
    return ts ?? Number.POSITIVE_INFINITY;
  }

  private formatMadridDateTime(date: Date): string {
    const p = this.getMadridParts(date);
    const pad = (n: number) => n.toString().padStart(2, '0');
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

  private getBestPhone(row: any): string | null {
    return this.getBestPhoneWithReason(row).phone;
  }
}
