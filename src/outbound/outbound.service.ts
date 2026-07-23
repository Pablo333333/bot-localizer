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

/** Valores que marcan la fila como ya procesada (no volver a llamar). */
const MARKED_STATUSES = new Set(['SI', 'SÍ', 'INTENTADO', 'YES', 'TRUE']);

const COL_C1_CON = 'Contacto1 con';
const COL_C1_TEL = 'Teléfonos de contacto';
const COL_C2_CON = 'Contacto2 con';
const COL_C2_TEL = 'Telefono2';
const COL_C3_CON = 'Contacto3 con';
const COL_C3_TEL = 'Telefono3';

const MAX_DAILY_CALLS = 5;
const DELAY_BETWEEN_CALLS_MS = 90_000;
const ANTI_REPEAT_MS = 12 * 60 * 60 * 1000; // 12 horas
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

  /** Teléfonos ya intentados hoy (Europe/Madrid). */
  private readonly attemptedPhonesToday = new Set<string>();
  /** Teléfono → timestamp del último intento (anti-repetición 12h). */
  private readonly lastAttemptByPhone = new Map<string, number>();
  /** Contador de INTENTOS (disparos a Retell) del día Madrid. */
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

    this.rotateDailyCountersIfNeeded();

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

    // Límite diario = INTENTOS (memoria + filas marcadas hoy en Sheets)
    const sheetAttemptsToday = this.countAttemptsTodayFromSheet(rows);
    const attemptsToday = Math.max(this.dailyAttemptCount, sheetAttemptsToday);

    if (attemptsToday >= MAX_DAILY_CALLS) {
      this.dailyAttemptCount = Math.max(this.dailyAttemptCount, sheetAttemptsToday);
      this.logger.log(
        `[OutboundService] Límite diario de INTENTOS alcanzado (${attemptsToday}/${MAX_DAILY_CALLS}). Cron detenido hasta mañana.`,
      );
      return;
    }

    let remainingToday = MAX_DAILY_CALLS - attemptsToday;
    this.logger.log(
      `Cupo diario de intentos: ${attemptsToday}/${MAX_DAILY_CALLS}. Disponibles: ${remainingToday}`,
    );

    const pendingRows = rows
      .filter((row) => this.isPendingRow(row))
      .sort((a, b) => {
        const dateA = this.parseMarcaTemporal(a.get(COL_MARCA_TEMPORAL)?.toString());
        const dateB = this.parseMarcaTemporal(b.get(COL_MARCA_TEMPORAL)?.toString());
        return dateA - dateB;
      });

    this.logger.log(
      `[OutboundService] ${pendingRows.length} filas pendientes en "${SHEET_NAME}" (orden Marca temporal ASC).`,
    );

    let callsLaunchedThisRun = 0;

    for (const row of pendingRows) {
      if (remainingToday <= 0) break;

      const rawPhone = this.getBestPhone(row);
      if (!rawPhone) continue;

      const phone = this.formatE164Spain(rawPhone);
      const phoneKey = this.normalizePhoneKey(phone);

      // Anti-repetición en memoria (hoy + últimas 12h)
      if (this.attemptedPhonesToday.has(phoneKey)) {
        this.logger.log(`[OutboundService] Skip ${phone}: ya intentado hoy (memoria).`);
        continue;
      }
      const lastTs = this.lastAttemptByPhone.get(phoneKey);
      if (lastTs && Date.now() - lastTs < ANTI_REPEAT_MS) {
        this.logger.log(
          `[OutboundService] Skip ${phone}: intentado en las últimas 12h (memoria).`,
        );
        continue;
      }

      // Anti-repetición desde Sheets (Fecha actualización < 12h)
      if (this.wasAttemptedInLast12Hours(row)) {
        this.logger.log(
          `[OutboundService] Skip ${phone}: Fecha actualización dentro de las últimas 12h.`,
        );
        // Sincronizar memoria para no re-evaluar
        this.rememberAttempt(phoneKey);
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
              '[OutboundService] Se salió del horario laboral durante el retardo. Deteniendo lote.',
            );
            break;
          }
        }

        // 1) MARCAR INTENTO EN SHEETS ANTES de pegarle a Retell (anti-bucle crítico)
        row.set(COL_LLAMADO_FP, 'SI');
        row.set(COL_FECHA_ACTUALIZACION, nowLabel);
        await row.save();
        this.logger.log(
          `[OutboundService] Fila marcada Llamado FP=SI ANTES de Retell → ${phone}`,
        );

        // 2) Contar intento + memoria (aunque Retell falle después)
        this.rememberAttempt(phoneKey);
        this.dailyAttemptCount++;
        remainingToday--;
        callsLaunchedThisRun++;

        // 3) Disparar llamada a Retell
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
          `Intento disparado — número: ${phone} | call_id: ${call.call_id} | intentos hoy: ${this.dailyAttemptCount}/${MAX_DAILY_CALLS}`,
        );
      } catch (err) {
        // La fila YA quedó marcada SI + Fecha actualización; no se reintentará
        this.logger.error(
          `Error al llamar al número ${phone} (fila ya marcada, no se reintentará): ${(err as Error).message}`,
        );
      }
    }

    this.logger.log(
      `[OutboundService] Ciclo terminado. Intentos en este run: ${callsLaunchedThisRun}. Total día: ${this.dailyAttemptCount}/${MAX_DAILY_CALLS}`,
    );
  }

  private isPendingRow(row: any): boolean {
    const llamadoFp = row.get(COL_LLAMADO_FP)?.toString().trim().toUpperCase() || '';
    if (MARKED_STATUSES.has(llamadoFp)) return false;

    const callId = row.get(COL_CALL_ID)?.toString().trim();
    if (callId) return false;

    return true;
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
        `[OutboundService] Nuevo día Madrid (${todayKey}). Reset contadores diarios en memoria.`,
      );
      this.dailyAttemptDateKey = todayKey;
      this.dailyAttemptCount = 0;
      this.attemptedPhonesToday.clear();
    }
  }

  private getMadridDateKey(date: Date): string {
    const p = this.getMadridParts(date);
    return `${p.year}-${p.month}-${p.day}`;
  }

  private normalizePhoneKey(phone: string): string {
    return phone.replace(/\D/g, '');
  }

  private wasAttemptedInLast12Hours(row: any): boolean {
    const fecha = row.get(COL_FECHA_ACTUALIZACION)?.toString().trim();
    if (!fecha) return false;
    const ts = this.parseSheetDateTime(fecha);
    if (ts === null) return false;
    return Date.now() - ts < ANTI_REPEAT_MS;
  }

  /**
   * Cuenta INTENTOS de hoy en Sheets: filas con Llamado FP marcado
   * y Fecha actualización del día Madrid actual.
   */
  private countAttemptsTodayFromSheet(rows: any[]): number {
    const todayKey = this.getMadridDateKey(new Date());

    return rows.filter((row) => {
      const llamadoFp = row.get(COL_LLAMADO_FP)?.toString().trim().toUpperCase() || '';
      const callId = row.get(COL_CALL_ID)?.toString().trim();
      const marked = MARKED_STATUSES.has(llamadoFp) || !!callId;
      if (!marked) return false;

      const fecha = row.get(COL_FECHA_ACTUALIZACION)?.toString().trim() || '';
      if (!fecha) return false;

      const datePart = fecha.split(/\s+/)[0];
      const match = datePart.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
      if (!match) return false;

      const key = `${Number(match[3])}-${Number(match[2])}-${Number(match[1])}`;
      return key === todayKey;
    }).length;
  }

  private parseSheetDateTime(raw: string): number | null {
    const cleaned = raw.trim().replace(',', '');
    const match = cleaned.match(
      /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/,
    );
    if (!match) return null;

    const [, d, m, y, hh = '0', mm = '0', ss = '0'] = match;
    // Interpretar como hora Madrid → UTC aproximado vía Date con offset no fiable;
    // usamos componentes locales equivalentes (suficiente para ventana 12h).
    const ts = new Date(
      Number(y),
      Number(m) - 1,
      Number(d),
      Number(hh),
      Number(mm),
      Number(ss),
    ).getTime();
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
    const cleaned = raw.trim().replace(',', '');
    const match = cleaned.match(
      /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/,
    );
    if (match) {
      const [, d, m, y, hh = '0', mm = '0', ss = '0'] = match;
      const ts = new Date(
        Number(y),
        Number(m) - 1,
        Number(d),
        Number(hh),
        Number(mm),
        Number(ss),
      ).getTime();
      return Number.isNaN(ts) ? Number.POSITIVE_INFINITY : ts;
    }
    const fallback = Date.parse(cleaned);
    return Number.isNaN(fallback) ? Number.POSITIVE_INFINITY : fallback;
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

    if (validContacts.every((c) => c.role === 'Profesional')) return null;

    return validContacts[0].phone;
  }
}
