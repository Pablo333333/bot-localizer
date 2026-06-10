import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import Retell from 'retell-sdk';
import { SheetsService } from '../sheets/sheets.service';

const COL_CALL_STATUS = 'Llamado';
const COL_CALL_ID = 'Call ID';
const COL_TIPO_INMUEBLE = 'Tipo de inmueble';
const COL_DISPONIBILIDAD = 'Disponibilidad del local';
const STATUS_LLAMADO = 'Sí';

// Columnas de contactos según especificación del cliente
const COL_C1_CON = 'Contacto1 con';
const COL_C1_TEL = 'Teléfonos de contacto';
const COL_C2_CON = 'Contacto2 con';
const COL_C2_TEL = 'Telefono2';
const COL_C3_CON = 'Contacto3 con';
const COL_C3_TEL = 'Telefono3';

// TODO Fase 2: Implementar POST /outbound/trigger-batch para envíos masivos bajo demanda.
@Injectable()
export class OutboundService {
  private readonly logger = new Logger(OutboundService.name);
  private readonly retell: Retell;
  private readonly agentId: string;
  private readonly fromNumber: string;

  constructor(
    private readonly sheetsService: SheetsService,
    private readonly configService: ConfigService,
  ) {
    this.retell = new Retell({
      apiKey: this.configService.getOrThrow<string>('RETELL_API_KEY'),
    });
    this.agentId = this.configService.getOrThrow<string>('RETELL_AGENT_ID');
    this.fromNumber = this.configService.getOrThrow<string>('RETELL_FROM_NUMBER');
  }

  @Cron(CronExpression.EVERY_5_MINUTES)
  async checkPendingCalls(): Promise<void> {
    this.logger.log('Iniciando control de llamadas salientes...');

    const doc = this.sheetsService.getDoc();
    const sheet = doc.sheetsByIndex[0];

    await sheet.loadHeaderRow();
    const rows = await sheet.getRows();

    // Control global previo: contar llamadas ya realizadas o en proceso
    const alreadyCalledRows = rows.filter((row) => {
      const status = row.get(COL_CALL_STATUS)?.toString().trim();
      const callId = row.get(COL_CALL_ID)?.toString().trim();
      return status || callId;
    });

    const totalCallsMade = alreadyCalledRows.length;
    const GLOBAL_LIMIT = 10;

    if (totalCallsMade >= GLOBAL_LIMIT) {
      this.logger.log(
        `[OutboundService] Límite global absoluto de ${GLOBAL_LIMIT} llamadas de prueba alcanzado en el Sheets. No se realizarán más llamadas.`,
      );
      return;
    }

    let remainingCalls = GLOBAL_LIMIT - totalCallsMade;
    this.logger.log(
      `Estado global: ${totalCallsMade}/${GLOBAL_LIMIT} llamadas realizadas. Cupo disponible: ${remainingCalls}`,
    );

    for (const row of rows) {
      if (remainingCalls <= 0) break;

      const status = row.get(COL_CALL_STATUS)?.toString().trim();
      const callId = row.get(COL_CALL_ID)?.toString().trim();
      if (status || callId) continue;

      const rawPhone = this.getBestPhone(row);
      if (!rawPhone) continue;

      // Formateador estricto E.164 para España
      let phone = rawPhone.replace(/\s+/g, '');
      if (phone.startsWith('+34')) {
        // Ya tiene el formato correcto
      } else if (phone.startsWith('34')) {
        phone = '+' + phone;
      } else {
        phone = '+34' + phone;
      }

      const tipoInmueble = row.get(COL_TIPO_INMUEBLE)?.toString().trim() || '';
      const disponibilidad = row.get(COL_DISPONIBILIDAD)?.toString().trim() || '';

      try {
        const call = await this.retell.call.createPhoneCall({
          from_number: this.fromNumber,
          to_number: phone,
          override_agent_id: this.agentId,
          retell_llm_dynamic_variables: {
            tipo_inmueble: tipoInmueble,
            disponibilidad: disponibilidad,
          },
        });

        // Actualización síncrona para blindar el anti-loop
        row.set(COL_CALL_STATUS, STATUS_LLAMADO);
        row.set(COL_CALL_ID, call.call_id);
        await row.save();

        this.logger.log(
          `Llamada iniciada con éxito — número: ${phone} | call_id: ${call.call_id}`,
        );
        remainingCalls--;
      } catch (err) {
        this.logger.error(
          `Error al llamar al número ${phone}: ${(err as Error).message}`,
        );
      }
    }
  }

  /**
   * Selecciona el mejor teléfono según la prioridad:
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

    // Filtrar solo contactos que tengan un teléfono
    const validContacts = contacts.filter((c) => c.phone);

    if (validContacts.length === 0) return null;

    // Prioridad 1: "Particular"
    const particular = validContacts.find((c) => c.role === 'Particular');
    if (particular) return particular.phone;

    // Prioridad 2: "Indeterminado" o vacío/no especificado
    const indeterminado = validContacts.find(
      (c) => !c.role || c.role === 'Indeterminado',
    );
    if (indeterminado) return indeterminado.phone;

    // Prioridad 3: "Profesional"
    // Si todos los contactos disponibles son "Profesional", devolvemos null para saltar la fila
    const allProfesional = validContacts.every((c) => c.role === 'Profesional');
    if (allProfesional) {
      return null;
    }

    // Por defecto, si hay contactos y no son todos profesionales, devolvemos el primero
    return validContacts[0].phone;
  }
}
