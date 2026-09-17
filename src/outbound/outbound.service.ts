import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import Retell from 'retell-sdk';
import { SheetsService } from '../sheets/sheets.service';
import { resolveRetellFromNumber } from '../nurturing/toni-fase3.constants';
import {
  OUTBOUND_AUTO_DIAL_PAUSED,
  OUTBOUND_AUTO_DIAL_PAUSED_LOG,
  OUTBOUND_CALLS_DISABLED_LOG,
  OUTBOUND_PHASE1_ACTIVE_LOG,
  describeOutboundMode,
  isOutboundCallsEnabled,
} from './outbound-enabled';
import {
  findPublicacionAutorizadaHeader,
  isPublicacionAutorizadaSi,
  readPublicacionAutorizadaRaw,
} from './publicacion-autorizada';
import { buildRetellDynamicVariables, RETELL_OUTBOUND_VARIABLE_KEYS } from './retell-dynamic-variables';
import {
  OUTBOUND_HOURS_DESCRIPTION,
  OUTBOUND_TIMEZONE,
  isWithinOutboundCallHours,
  pickOutboundInterCallDelayMs,
  resolveMaxDailyCalls,
  resolveOutboundDelayRangeMs,
} from './outbound-schedule';
import {
  matchesOutboundTestPhone,
  resolveOutboundTestPhoneOnly,
} from './outbound-test-phone';
import {
  OUTBOUND_SANDBOX_WHITELIST_E164,
  OUTBOUND_SANDBOX_WHITELIST_LOG,
  SKIPPED_SANDBOX_WHITELIST,
  isAllowedOutboundSandboxPhone,
  isOutboundSandboxWhitelistEnabled,
  safeCreatePhoneCall,
} from './outbound-sandbox-whitelist';

const SHEET_NAME = 'Localizados';
const COL_LLAMADO = 'Llamado';
const COL_CALL_ID = 'Call ID';
const COL_MARCA_TEMPORAL = 'Marca temporal';
const COL_FECHA_ACTUALIZACION = 'Fecha actualizacion';

const MARKED_STATUSES = new Set(['SI', 'SÍ', 'INTENTADO', 'YES', 'TRUE']);

// Teléfonos y roles exactos de la pestaña Localizados
const COL_C1_ROL = 'Contacto1 por';
const COL_C1_TEL = 'Telefono1';
const COL_C2_ROL = 'Contacto2 por';
const COL_C2_TEL = 'Telefono2';
const COL_C3_ROL = 'Contacto3 por';
const COL_C3_TEL = 'Telefono3';

const ANTI_REPEAT_MS = 12 * 60 * 60 * 1000;
const TIMEZONE = OUTBOUND_TIMEZONE;

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
  /** Próximo instante permitido para discar (ritmo orgánico 5–10 min). */
  private nextAllowedDialAt = 0;

  constructor(
    private readonly sheetsService: SheetsService,
    private readonly configService: ConfigService,
  ) {
    this.retell = new Retell({
      apiKey: this.configService.getOrThrow<string>('RETELL_API_KEY'),
    });
    this.agentId = this.configService.getOrThrow<string>('RETELL_OUTBOUND_AGENT_ID');
    this.logger.log(
      `[OutboundService] Agente outbound Retell activo: ${this.agentId} (RETELL_OUTBOUND_AGENT_ID)`,
    );
    this.fromNumber = resolveRetellFromNumber(
      this.configService.get<string>('RETELL_FROM_NUMBER'),
    );
    const mode = this.resolveMode();
    const delayRange = resolveOutboundDelayRangeMs({
      minRaw: this.configService.get('OUTBOUND_DELAY_MIN_MS'),
      maxRaw: this.configService.get('OUTBOUND_DELAY_MAX_MS'),
    });
    this.logger.log(
      `[OutboundService] Arranque mode=${JSON.stringify(mode)} horario=${OUTBOUND_HOURS_DESCRIPTION} espaciado=${Math.round(delayRange.minMs / 60_000)}–${Math.round(delayRange.maxMs / 60_000)} min entre llamadas`,
    );
    if (isOutboundSandboxWhitelistEnabled(
      this.configService.get('OUTBOUND_SANDBOX_WHITELIST_ENABLED'),
    )) {
      this.logger.warn(OUTBOUND_SANDBOX_WHITELIST_LOG);
    }
    if (OUTBOUND_AUTO_DIAL_PAUSED) {
      this.logger.warn(OUTBOUND_AUTO_DIAL_PAUSED_LOG);
    }
    if (mode.testFilterActive) {
      this.logger.warn(
        `[Outbound TEST FILTER] ACTIVO — solo ${this.configService.get('OUTBOUND_TEST_PHONE_ONLY')} (quitar para lote Fase 1 masivo)`,
      );
    }
    if (mode.phase1MassBatch && !mode.phase3NurturingEnabled) {
      this.logger.log(OUTBOUND_PHASE1_ACTIVE_LOG);
    }
  }

  /** Config leída en cada ciclo (permite cambiar env en Railway sin redeploy de código). */
  private resolveMode() {
    return describeOutboundMode({
      outboundCallsEnabled: this.configService.get('OUTBOUND_CALLS_ENABLED'),
      nurturingPhase3Enabled: this.configService.get('NURTURING_PHASE3_ENABLED'),
      testPhoneOnly: resolveOutboundTestPhoneOnly(
        this.configService.get('OUTBOUND_TEST_PHONE_ONLY'),
      ),
      maxDailyCalls: resolveMaxDailyCalls(
        this.configService.get('MAX_DAILY_CALLS'),
      ),
    });
  }

  /**
   * Lote Fase 1 cada 5 min. Solo llama L-V 10:00-14:00 y 17:00-20:30 Madrid,
   * máximo MAX_DAILY_CALLS (30). Máx. 1 llamada por ciclo, espaciadas 5–10 min
   * al azar (anti-ráfaga). Fase 3 no entra aquí.
   */
  @Cron(CronExpression.EVERY_5_MINUTES)
  async checkPendingCalls(): Promise<void> {
    if (OUTBOUND_AUTO_DIAL_PAUSED) {
      this.logger.warn(OUTBOUND_AUTO_DIAL_PAUSED_LOG);
      return;
    }

    const mode = this.resolveMode();
    if (!mode.outboundEnabled) {
      this.logger.log(OUTBOUND_CALLS_DISABLED_LOG);
      return;
    }

    if (!mode.phase3NurturingEnabled) {
      this.logger.log(
        `[OutboundService] Fase 3 nurturing OFF — lote Solo Fase 1 (sin WA/enroll T+7/T+10). cupo=${mode.maxDailyCalls}`,
      );
    } else {
      this.logger.log(
        `[OutboundService] Fase 1 lote=${mode.maxDailyCalls}/día; Fase 3 master ON pero solo allowlist Toni (resto sin enroll T+7/T+10)`,
      );
    }

    if (mode.testFilterActive) {
      this.logger.warn(
        `[Outbound TEST FILTER] activo (${this.configService.get('OUTBOUND_TEST_PHONE_ONLY')}) — no es lote masivo`,
      );
    }

    if (this.isRunning) {
      this.logger.log(
        '[OutboundService] Descartado ciclo: ejecución anterior aún en curso.',
      );
      return;
    }

    this.isRunning = true;
    try {
      await this.processPendingCalls(mode.maxDailyCalls);
    } finally {
      this.isRunning = false;
    }
  }

  private async processPendingCalls(maxDailyCalls: number): Promise<void> {
    if (OUTBOUND_AUTO_DIAL_PAUSED) {
      this.logger.warn(OUTBOUND_AUTO_DIAL_PAUSED_LOG);
      return;
    }

    const madridNow = this.getMadridParts(new Date());
    this.logger.log(
      `[OutboundService] Inicio ciclo Fase 1. Hora Madrid: ${madridNow.day}/${madridNow.month}/${madridNow.year} ${String(madridNow.hour).padStart(2, '0')}:${String(madridNow.minute).padStart(2, '0')} (weekday=${madridNow.weekday}) cupo=${maxDailyCalls}`,
    );

    if (!this.isWithinBusinessHours()) {
      this.logger.log(
        `[OutboundService] Descartado ciclo: Fuera de horario laboral (${OUTBOUND_HOURS_DESCRIPTION}). Lunes primera hora = desde 10:00 Madrid.`,
      );
      return;
    }

    this.rotateDailyCountersIfNeeded();

    const testPhoneOnly = resolveOutboundTestPhoneOnly(
      this.configService.get('OUTBOUND_TEST_PHONE_ONLY'),
    );

    if (
      isOutboundSandboxWhitelistEnabled(
        this.configService.get('OUTBOUND_SANDBOX_WHITELIST_ENABLED'),
      )
    ) {
      this.logger.warn(
        `[OutboundService] SANDBOX activo — solo ${OUTBOUND_SANDBOX_WHITELIST_E164}. Desactiva OUTBOUND_SANDBOX_WHITELIST_ENABLED para lote Fase 1.`,
      );
    }

    const { sheet, rows } = await this.sheetsService.getAllRows(SHEET_NAME);

    if (!sheet) {
      this.logger.error(
        `[OutboundService] Descartado ciclo: no existe la pestaña "${SHEET_NAME}".`,
      );
      return;
    }

    this.hydrateDailyCountFromSheet(rows, maxDailyCalls);

    const headers = sheet.headerValues || [];
    const pubHeader = findPublicacionAutorizadaHeader(headers);
    this.logger.log(
      `[OutboundService] Cabeceras clave → Publicacion Autorizada?: ${pubHeader ? `OK ("${pubHeader}" idx=${headers.indexOf(pubHeader)})` : 'FALTA'} | Llamado: ${headers.includes(COL_LLAMADO) ? 'OK' : 'FALTA'} | Telefono1: ${headers.includes(COL_C1_TEL) ? 'OK' : 'FALTA'} | Contacto1 por: ${headers.includes(COL_C1_ROL) ? 'OK' : 'FALTA'} | Call ID: ${headers.includes(COL_CALL_ID) ? 'OK' : 'FALTA'} | Marca temporal: ${headers.includes(COL_MARCA_TEMPORAL) ? 'OK' : 'FALTA'}`,
    );

    this.logger.log(
      `[OutboundService] Filas leídas en "${SHEET_NAME}": ${rows.length} (grid rowCount=${sheet.rowCount})`,
    );

    // Límite diario: SOLO memoria (no bloquear por formatos raros de Fecha actualización)
    const attemptsToday = this.dailyAttemptCount;
    this.logger.log(
      `[OutboundService] Cupo diario (memoria): ${attemptsToday}/${maxDailyCalls}. Set teléfonos hoy: ${this.attemptedPhonesToday.size}`,
    );

    if (attemptsToday >= maxDailyCalls) {
      this.logger.log(
        `[OutboundService] Descartado ciclo: Límite alcanzado (${attemptsToday}/${maxDailyCalls}).`,
      );
      return;
    }

    const now = Date.now();
    if (this.nextAllowedDialAt > now) {
      const waitSec = Math.ceil((this.nextAllowedDialAt - now) / 1000);
      this.logger.log(
        `[OutboundService] Descartado ciclo: ritmo orgánico — próxima llamada en ~${waitSec}s (anti-ráfaga operadoras).`,
      );
      return;
    }

    let remainingToday = maxDailyCalls - attemptsToday;

    // Clasificar filas con motivo explícito de descarte
    type Candidate = {
      row: any;
      rowNumber: number;
      phone: string;
      phoneKey: string;
      contactIndex?: 1 | 2 | 3;
      marcaTs: number;
    };
    const candidates: Candidate[] = [];
    let discardedCount = 0;

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNumber = row.rowNumber; // 1-based real del Sheet (headers = 1)
      const reason = this.getDiscardReason(row, rowNumber, headers);

      if (reason) {
        discardedCount++;
        this.logger.log(
          `[OutboundService] Fila ${rowNumber} descartada: ${reason}`,
        );
        continue;
      }

      const rawPhone = this.getBestPhone(row)!;
      const phone = this.formatE164Spain(rawPhone);

      if (!isAllowedOutboundSandboxPhone(phone)) {
        discardedCount++;
        this.logger.log(
          `[OutboundService] Fila ${rowNumber} ${SKIPPED_SANDBOX_WHITELIST} (${phone}) — sandbox solo ${OUTBOUND_SANDBOX_WHITELIST_E164}`,
        );
        continue;
      }

      if (
        testPhoneOnly &&
        !matchesOutboundTestPhone(phone, testPhoneOnly)
      ) {
        discardedCount++;
        this.logger.log(
          `[Outbound TEST FILTER] Saltando lead fila ${rowNumber} (${phone}) por no coincidir con ${testPhoneOnly}`,
        );
        continue;
      }

      const phonePick = this.getBestPhoneWithReason(row);
      candidates.push({
        row,
        rowNumber,
        phone,
        phoneKey: this.normalizePhoneKey(phone),
        contactIndex: phonePick.contactIndex,
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
          `[OutboundService] Fila ${candidate.rowNumber} descartada: Límite alcanzado (${this.dailyAttemptCount}/${maxDailyCalls}).`,
        );
        break;
      }

      const { row, rowNumber, phone, phoneKey, contactIndex } = candidate;

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

      const { variables: dynamicVars, missing: missingDynamicVars } =
        buildRetellDynamicVariables(row, { phoneE164: phone, contactIndex });
      for (const varName of missingDynamicVars) {
        this.logger.warn(
          `[WARN] Variable Retell "${varName}" vacía o ausente — fila ${rowNumber}, teléfono ${phone}`,
        );
      }
      const nowLabel = this.formatMadridDateTime(new Date());

      try {
        // Ritmo orgánico: como máximo 1 disparo Retell por ciclo de cron.
        // El espaciado 5–10 min se aplica vía nextAllowedDialAt (no ráfaga 90s).
        if (callsLaunchedThisRun > 0) {
          this.logger.log(
            `[OutboundService] Ya se lanzó 1 llamada en este ciclo — resto queda para el siguiente hueco orgánico.`,
          );
          break;
        }

        this.logger.log(
          `[OutboundService] Fila ${rowNumber} ACEPTADA (sandbox) → marcando Llamado=SI y disparando Retell (${phone}) | municipio="${dynamicVars.municipio || '(vacío)'}"`,
        );

        const guarded = await safeCreatePhoneCall(
          this.retell,
          {
            from_number: this.fromNumber,
            to_number: phone,
            override_agent_id: this.agentId,
            retell_llm_dynamic_variables: dynamicVars,
          },
          (msg) => this.logger.warn(msg),
        );

        if (guarded.skipped) {
          this.logger.warn(
            `[OutboundService] Fila ${rowNumber} ${guarded.skipCode} — no se marca Llamado ni se llama a Retell (${phone})`,
          );
          continue;
        }

        // Marcar ANTES de persistir call_id — solo celdas de tracking (nunca row.save() de fila completa)
        await this.sheetsService.updateTrackingCells(sheet, row.rowNumber, {
          [COL_LLAMADO]: 'SI',
          [COL_FECHA_ACTUALIZACION]: nowLabel,
        }, row);

        this.rememberAttempt(phoneKey);
        this.dailyAttemptCount++;
        remainingToday--;
        callsLaunchedThisRun++;
        this.scheduleNextOrganicDialSlot();

        this.logger.log(
          `[OutboundService] createPhoneCall agent=${this.agentId} fila=${rowNumber} tel=${phone} retell_llm_dynamic_variables (${Object.keys(dynamicVars).length}/${RETELL_OUTBOUND_VARIABLE_KEYS.length}): ${JSON.stringify(dynamicVars)}`,
        );

        const call = guarded.call;

        await this.sheetsService.updateTrackingCells(sheet, row.rowNumber, {
          [COL_CALL_ID]: call.call_id,
        });

        this.logger.log(
          `[OutboundService] Fila ${rowNumber} OK — call_id=${call.call_id} | intentos hoy=${this.dailyAttemptCount}/${maxDailyCalls}`,
        );
        break;
      } catch (err) {
        this.logger.error(
          `[OutboundService] Fila ${rowNumber} error Retell: ${(err as Error).message}`,
        );
      }
    }

    this.logger.log(
      `[OutboundService] Ciclo terminado. Intentos en este run: ${callsLaunchedThisRun}. Total día (memoria): ${this.dailyAttemptCount}/${maxDailyCalls}`,
    );
  }

  /**
   * Devuelve el motivo de descarte, o null si la fila es candidata.
   */
  private getDiscardReason(
    row: any,
    rowNumber: number,
    headerValues?: string[],
  ): string | null {
    if (!isPublicacionAutorizadaSi(row, headerValues)) {
      const raw = readPublicacionAutorizadaRaw(row, headerValues);
      return `Publicacion Autorizada? no es SI ("${String(raw).trim() || 'vacío'}") — no se llama ni se procesa`;
    }

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

  private getBestPhoneWithReason(row: any): {
    phone: string | null;
    contactIndex?: 1 | 2 | 3;
    reason?: string;
  } {
    const contacts: Array<{
      index: 1 | 2 | 3;
      label: string;
      role: string | undefined;
      phone: string | undefined;
    }> = [
      {
        index: 1,
        label: 'Telefono1/Contacto1 por',
        role: row.get(COL_C1_ROL)?.toString().trim(),
        phone: row.get(COL_C1_TEL)?.toString().trim(),
      },
      {
        index: 2,
        label: 'Telefono2/Contacto2 por',
        role: row.get(COL_C2_ROL)?.toString().trim(),
        phone: row.get(COL_C2_TEL)?.toString().trim(),
      },
      {
        index: 3,
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
    if (particular) {
      return { phone: particular.phone!, contactIndex: particular.index };
    }

    const indeterminado = validContacts.find((c) => {
      const role = (c.role || '').trim().toLowerCase();
      return !role || role === 'indeterminado';
    });
    if (indeterminado) {
      return { phone: indeterminado.phone!, contactIndex: indeterminado.index };
    }

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

    return {
      phone: validContacts[0].phone!,
      contactIndex: validContacts[0].index,
    };
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

  /**
   * Tras restart de Railway el contador en memoria queda a 0.
   * Rehidrata desde filas con Llamado=SI y Fecha actualización de hoy (Madrid)
   * para no superar MAX_DAILY_CALLS ni re-llamar los mismos números.
   */
  private hydrateDailyCountFromSheet(
    rows: Array<{ get: (key: string) => unknown }>,
    maxDailyCalls: number,
  ): void {
    this.rotateDailyCountersIfNeeded();
    const todayKey = this.dailyAttemptDateKey;
    let sheetToday = 0;

    for (const row of rows) {
      const llamadoRaw = String(row.get(COL_LLAMADO) ?? '')
        .trim()
        .toUpperCase();
      if (!MARKED_STATUSES.has(llamadoRaw)) continue;

      const fechaRaw =
        String(row.get(COL_FECHA_ACTUALIZACION) ?? '').trim() ||
        String(row.get('Fecha Llamada') ?? '').trim() ||
        String(row.get('Fecha llamada') ?? '').trim();
      if (!fechaRaw) continue;

      const ts = this.parseFlexibleDateTime(fechaRaw);
      if (ts == null) continue;
      if (this.getMadridDateKey(new Date(ts)) !== todayKey) continue;

      sheetToday += 1;
      const phoneRaw = this.getBestPhone(row);
      if (phoneRaw) {
        const phoneKey = this.normalizePhoneKey(this.formatE164Spain(phoneRaw));
        this.attemptedPhonesToday.add(phoneKey);
        const prev = this.lastAttemptByPhone.get(phoneKey) || 0;
        if (ts > prev) this.lastAttemptByPhone.set(phoneKey, ts);
      }
    }

    if (sheetToday > this.dailyAttemptCount) {
      this.logger.log(
        `[OutboundService] Cupo rehidratado desde Sheet: memoria=${this.dailyAttemptCount} → sheetHoy=${sheetToday}/${maxDailyCalls}`,
      );
      this.dailyAttemptCount = sheetToday;
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
    return isWithinOutboundCallHours(this.getMadridParts(now));
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

  /**
   * Programa el próximo hueco de discado con delay aleatorio 5–10 min
   * (configurable vía OUTBOUND_DELAY_MIN_MS / OUTBOUND_DELAY_MAX_MS).
   */
  private scheduleNextOrganicDialSlot(): void {
    const { minMs, maxMs } = resolveOutboundDelayRangeMs({
      minRaw: this.configService.get('OUTBOUND_DELAY_MIN_MS'),
      maxRaw: this.configService.get('OUTBOUND_DELAY_MAX_MS'),
    });
    const delayMs = pickOutboundInterCallDelayMs(minMs, maxMs);
    this.nextAllowedDialAt = Date.now() + delayMs;
    const mins = (delayMs / 60_000).toFixed(1);
    this.logger.log(
      `[OutboundService] Ritmo orgánico: próxima llamada no antes de ${mins} min (rango ${Math.round(minMs / 60_000)}–${Math.round(maxMs / 60_000)} min).`,
    );
  }

  private getBestPhone(row: any): string | null {
    return this.getBestPhoneWithReason(row).phone;
  }
}
