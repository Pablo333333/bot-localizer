import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { GoogleSpreadsheet, GoogleSpreadsheetWorksheet } from 'google-spreadsheet';
import { JWT } from 'google-auth-library';
import * as fs from 'fs';
import * as path from 'path';

const SPREADSHEET_ID = '1sXfBv7T3HyIahiMDTHslyxCvei6Iv9ZRBLkaPIPNXb0';

@Injectable()
export class SheetsService implements OnModuleInit {
  private readonly logger = new Logger(SheetsService.name);
  private doc: GoogleSpreadsheet;

  async onModuleInit(): Promise<void> {
    const credentials = JSON.parse(
      fs.readFileSync(
        path.join(process.cwd(), 'google-credentials.json'),
        'utf8',
      ),
    );

    const auth = new JWT({
      email: credentials.client_email,
      key: credentials.private_key,
      scopes: [
        'https://www.googleapis.com/auth/spreadsheets',
        'https://www.googleapis.com/auth/drive.readonly',
      ],
    });

    this.doc = new GoogleSpreadsheet(SPREADSHEET_ID, auth);
    await this.doc.loadInfo();

    const firstSheet = this.doc.sheetsByIndex[0];
    this.logger.log(
      `¡Conexión exitosa! Leyendo la hoja: ${firstSheet.title}`,
    );
  }

  getDoc(): GoogleSpreadsheet {
    return this.doc;
  }

  async addRow(data: RetellPayload): Promise<void> {
    const sheet: GoogleSpreadsheetWorksheet = this.doc.sheetsByIndex[0];
    await sheet.loadHeaderRow();

    const knownHeaders = new Set(sheet.headerValues);

    const cad = data.call_analysis?.custom_analysis_data;

    const mapping: Record<string, string | undefined> = {
      'Marca temporal':               new Date().toLocaleString(),
      'Referencia':                   data.call_id,
      'Descripción por el propietario': data.call_analysis?.call_summary,
      'Tipo de inmueble':             cad?.tipo_inmueble,
      'Disponibilidad del local':     cad?.disponibilidad,
      'Superficie Total':             cad?.superficie_total,
      'Superficie util':              cad?.superficie_util,
      'Negocio anterior':             cad?.negocio_anterior,
      'Numero aseos/baños':           cad?.aseos,
      'Estado':                       cad?.estado_local,
      'Nombre via':                   cad?.nombre_via,
      'Numero Via':                   cad?.altura,
      'Pueblo/Barrio/distrito':       cad?.pueblo,
      'Precio VENTA':                 cad?.precio_venta,
      'Precio TRASPASO':              cad?.precio_traspaso,
      'Precio ALQUILER/mes':          cad?.precio_alquiler,
      'Negociable?':                  cad?.es_negociable,
      'Gastos de comunidad':          cad?.gastos_comunidad,
      'Fianza':                       cad?.fianza,
      'Nombre contacto1':             cad?.nombre_propietario,
      'Teléfonos de contacto':        data.from_number,
      'Email propietario-gestor':     cad?.email,
    };

    // Solo incluir columnas que existen realmente en la hoja
    const rowValue: Record<string, string | undefined> = {};
    for (const [column, value] of Object.entries(mapping)) {
      if (knownHeaders.has(column)) {
        rowValue[column] = value;
      } else {
        this.logger.warn(`Columna no encontrada en la hoja, se omite: "${column}"`);
      }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await sheet.addRow(rowValue as any);
    this.logger.log(`Fila agregada correctamente para call_id: ${data.call_id}`);
  }
}

interface RetellPayload {
  call_id: string;
  from_number: string;
  call_analysis?: {
    call_summary?: string;
    custom_analysis_data?: {
      tipo_inmueble?: string;
      disponibilidad?: string;
      superficie_total?: string;
      superficie_util?: string;
      negocio_anterior?: string;
      aseos?: string;
      estado_local?: string;
      nombre_via?: string;
      altura?: string;
      pueblo?: string;
      precio_venta?: string;
      precio_traspaso?: string;
      precio_alquiler?: string;
      es_negociable?: string;
      gastos_comunidad?: string;
      fianza?: string;
      nombre_propietario?: string;
      email?: string;
    };
  };
}
