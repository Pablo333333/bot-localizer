import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { GoogleSpreadsheet, GoogleSpreadsheetWorksheet } from 'google-spreadsheet';
import { JWT } from 'google-auth-library';
import * as fs from 'fs';
import * as path from 'path';

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

    const spreadsheetId = process.env.SPREADSHEET_ID;
    if (!spreadsheetId) {
      throw new Error('SPREADSHEET_ID no está definido en las variables de entorno');
    }

    this.doc = new GoogleSpreadsheet(spreadsheetId, auth);
    await this.doc.loadInfo();

    const firstSheet = this.doc.sheetsByIndex[0];
    this.logger.log(
      `¡Conexión exitosa! Leyendo la hoja: ${firstSheet.title}`,
    );
  }

  getDoc(): GoogleSpreadsheet {
    return this.doc;
  }

  async addRow(data: RetellPayload, publicadoWP: string = 'NO'): Promise<void> {
    const sheet: GoogleSpreadsheetWorksheet = this.doc.sheetsByTitle['reC26'] || this.doc.sheetsByIndex[0];
    await sheet.loadHeaderRow();

    const knownHeaders = new Set(sheet.headerValues);
    const cad = data.call_analysis?.custom_analysis_data;

    // Función auxiliar para sanitizar valores
    const sanitize = (v: any, cleanSymbols: boolean = false) => {
      if (v === undefined || v === null) return '';
      let s = String(v).trim();
      const lowerS = s.toLowerCase();
      if (lowerS === 'no especificado' || lowerS === 'unknown' || lowerS === 'undefined' || lowerS === 'null') {
        return '';
      }
      if (cleanSymbols) {
        // Limpiar símbolos de moneda y unidades para campos numéricos
        s = s.replace(/[€$m²\s]/g, '').replace(',', '.');
      }
      return s;
    };

    const val = (v: any, fallback: string = '', cleanSymbols: boolean = false) => {
      const s = sanitize(v, cleanSymbols);
      return s !== '' ? s : fallback;
    };

    const mapping: Record<string, string> = {
      'Marca temporal':             new Date().toLocaleString('es-ES', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      }).replace(',', ''),
      'Llamado por':               'Localisto (IA)',
      'Propietario contactado?':    data.call_analysis?.call_successful ? 'SI' : 'NO',
      'Publicado Popalicer?':      publicadoWP,
      'Tipo de inmueble':          val(cad?.tipo_inmueble),
      'Disponibilidad':            val(cad?.disponibilidad),
      'Información adicional':     val(data.call_analysis?.call_summary || cad?.informacion_adicional),
      'Superficie Total':          val(cad?.superficie_total, '', true),
      'Superficie util':           val(cad?.superficie_util, '', true),
      'Negocio anterior':          val(cad?.negocio_anterior),
      'Estado':                    val(cad?.estado),
      'Año de construcción':       val(cad?.anio_construccion),
      'Año reforma':               val(cad?.anio_reforma),
      'Número aseos/baños':        val(cad?.numero_aseos || cad?.aseos, '', true),
      'Tipo Via':                  val(cad?.tipo_via),
      'Nombre via':                val(cad?.nombre_via),
      'Numero Via':                val(cad?.numero_via || cad?.altura),
      'Pueblo/Barrio/distrito':    val(cad?.pueblo_barrio || cad?.pueblo),
      'Municipio':                 val(cad?.municipio),
      'Provincia':                 val(cad?.provincia),
      'Precio VENTA':              val(cad?.precio_venta, '', true),
      'Precio TRASPASO':           val(cad?.precio_traspaso, '', true),
      'Precio ALQUILER/mes':       val(cad?.precio_alquiler, '', true),
      'Fianza':                    val(cad?.fianza_meses || cad?.fianza, '', true),
      'Gastos de comunidad':       val(cad?.gastos_comunidad, '', true),
      'Negociable':                val(cad?.es_negociable),
      'Nombre contacto1':          val(cad?.nombre_contacto_1 || cad?.nombre_propietario || cad?.nombre_contacto),
      'Email propietario-gestor':  val(cad?.email),
      'Teléfono contacto1':        val(data.from_number || data.to_number),
      'Vado (SI/NO)':              val(cad?.vado),
      'Altura techos':             val(cad?.altura_techos),
      'Notas de Error':            !data.call_analysis?.call_successful ? val(data.call_analysis?.call_summary) : '',
    };

    // Solo incluir columnas que existen realmente en la hoja
    const rowValue: Record<string, string> = {};
    for (const [column, value] of Object.entries(mapping)) {
      if (knownHeaders.has(column)) {
        rowValue[column] = value;
      }
    }

    this.logger.debug(`Escribiendo en reC26 para call_id ${data.call_id}`);
    await sheet.addRow(rowValue as any);
    this.logger.log(`Fila agregada correctamente en reC26 para call_id: ${data.call_id}`);
  }
}

interface RetellPayload {
  call_id: string;
  agent_id: string;
  from_number?: string;
  to_number?: string;
  call_analysis?: {
    call_successful?: boolean;
    call_summary?: string;
    custom_analysis_data?: {
      tipo_inmueble?: string;
      disponibilidad?: string;
      estado?: string;
      anio_construccion?: string;
      anio_reforma?: string;
      num_plantas?: string;
      superficie_total?: string;
      superficie_util?: string;
      aseos?: string;
      vado?: string;
      altura_techos?: string;
      iluminacion?: string;
      suelos?: string;
      certificacion?: string;
      provincia?: string;
      municipio?: string;
      pueblo?: string;
      tipo_via?: string;
      nombre_via?: string;
      altura?: string;
      precio_venta?: string;
      precio_traspaso?: string;
      precio_alquiler?: string;
      fianza?: string;
      gastos_comunidad?: string;
      es_negociable?: string;
      negocio_anterior?: string;
      nombre_propietario?: string;
      nombre_contacto?: string;
      nombre_contacto_1?: string;
      contacto_preferido?: string;
      email?: string;
      informacion_adicional?: string;
      numero_aseos?: string;
      numero_via?: string;
      pueblo_barrio?: string;
      fianza_meses?: string;
    };
  };
}
