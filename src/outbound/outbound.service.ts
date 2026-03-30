import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import Retell from 'retell-sdk';
import { SheetsService } from '../sheets/sheets.service';

const COL_PHONE = 'Teléfono';
const COL_CALL_STATUS = 'Estado Llamada';
const STATUS_INITIATED = 'Llamada Iniciada';

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
    this.logger.log('Buscando filas con llamadas pendientes...');

    const doc = this.sheetsService.getDoc();
    const sheet = doc.sheetsByIndex[0];

    await sheet.loadHeaderRow();
    const rows = await sheet.getRows();

    const pending = rows.filter((row) => {
      const phone = row.get(COL_PHONE)?.toString().trim();
      const status = row.get(COL_CALL_STATUS)?.toString().trim();
      return phone && !status;
    });

    if (pending.length === 0) {
      this.logger.log('No hay llamadas pendientes.');
      return;
    }

    this.logger.log(`Encontradas ${pending.length} filas pendientes.`);

    for (const row of pending) {
      const phone: string = row.get(COL_PHONE).toString().trim();

      try {
        const call = await this.retell.call.createPhoneCall({
          from_number: this.fromNumber,
          to_number: phone,
          override_agent_id: this.agentId,
        });

        row.set(COL_CALL_STATUS, STATUS_INITIATED);
        await row.save();

        this.logger.log(
          `Llamada iniciada — número: ${phone} | call_id: ${call.call_id}`,
        );
      } catch (err) {
        this.logger.error(
          `Error al llamar al número ${phone}: ${(err as Error).message}`,
        );
      }
    }
  }
}
