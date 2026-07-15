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
    let credentials: any;

    if (process.env.GOOGLE_CREDENTIALS_JSON) {
      try {
        credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON);
        this.logger.log(
          'Sheets Service: Usando credenciales desde variable de entorno',
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
      this.logger.log('Sheets Service: Usando credenciales desde archivo físico');
    }

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

  async addLead(data: {
    from: string;
    entities: any;
    state: string;
    summary?: string;
  }): Promise<void> {
    const sheet: GoogleSpreadsheetWorksheet = this.doc.sheetsByTitle['Localizados'] || this.doc.sheetsByIndex[0];
    await sheet.loadHeaderRow();

    const knownHeaders = new Set(sheet.headerValues);

    const mapping: Record<string, string> = {
      'Llamado por':               'Localisto (Lead Inbound)',
      'Teléfono contacto1':        data.from,
      'Nombre contacto1':          data.entities.nombre_usuario || '',
      'Tipo de inmueble':          data.entities.tipo_negocio || '',
      'Disponibilidad':            data.entities.operacion || '',
      'Municipio':                 data.entities.ubicacion || '',
      'Precio ALQUILER/mes':       data.entities.presupuesto_max?.toString() || '',
      'Estado':                    data.state,
      'Información adicional':     data.summary || '',
    };

    const rowValue: Record<string, string> = {};
    for (const [column, value] of Object.entries(mapping)) {
      if (knownHeaders.has(column)) {
        rowValue[column] = value;
      }
    }

    await sheet.addRow(rowValue as any);
    this.logger.log(`Lead de ${data.from} registrado correctamente en Sheets.`);
  }

  async addRow(data: RetellPayload, publicadoWP: string = 'NO'): Promise<void> {
    const sheet: GoogleSpreadsheetWorksheet = this.doc.sheetsByTitle['Localizados'] || this.doc.sheetsByIndex[0];
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

    // Funciones de validación de negocio
    const forceYesNo = (v: any) => {
      const s = String(v || '').toUpperCase().trim();
      return ['SI', 'SÍ', 'TRUE', '1', 'YES'].includes(s) ? 'SI' : 'NO';
    };

    const forceEstado = (v: any) => {
      const options = ['En construcción', 'Nuevo', 'Reformado', 'Buen estado', 'Buena conservación', 'Segunda mano - por Reformar'];
      const s = String(v || '').trim();
      const found = options.find(opt => opt.toLowerCase() === s.toLowerCase());
      return found || 'Buen estado'; // Valor por defecto
    };

    const forceCertificacion = (v: any) => {
      const options = ['No consta', 'Exento', 'En tramite', 'A', 'B', 'C', 'D', 'F', 'G'];
      const s = String(v || '').trim().toUpperCase();
      const found = options.find(opt => opt.toUpperCase() === s);
      if (found) return found;
      if (s === 'A' || s === 'B' || s === 'C' || s === 'D' || s === 'F' || s === 'G') return s;
      return 'No consta'; // Valor por defecto
    };

    const forcePublicadoPopalicer = (v: any) => {
      const options = ['Si', 'No', 'No en este momento', 'Posiblemente en un futuro', 'No estoy seguro ahora'];
      const s = String(v || '').trim();
      const found = options.find(opt => opt.toLowerCase() === s.toLowerCase());
      return found || 'No'; // Valor por defecto
    };

    const mapping: Record<string, string> = {
      'Llamado por':               'Localisto (IA)',
      'Propietario contactado?':    data.call_analysis?.call_successful ? new Date().toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' }) : 'NO',
      'Publicado Popalicer?':      forcePublicadoPopalicer(publicadoWP),
      'Tipo de inmueble':          val(cad?.tipo_inmueble),
      'Disponibilidad':            val(cad?.disponibilidad),
      'Información adicional':     val(data.call_analysis?.call_summary || cad?.informacion_adicional),
      'Superficie Total':          val(cad?.superficie_total, '', true),
      'Superficie util':           val(cad?.superficie_util, '', true),
      'Negocio anterior':          val(cad?.negocio_anterior),
      'Estado':                    forceEstado(cad?.estado),
      'Año de construcción':       val(cad?.anio_construccion),
      'Año reforma':               val(cad?.anio_reforma),
      'Numero aseos/baños':        val(cad?.numero_banios || cad?.numero_aseos || cad?.aseos, '', true),
      'Posición exacta':           val(cad?.posicion_exacta),
      'Escaparates/ventanales':    val(cad?.escaparates),
      'Disposición':               val(cad?.disposicion_diafano),
      'Diafano?':                  val(cad?.disposicion_diafano),
      'Eventos':                   val(cad?.eventos),
      'Almacen/trastienda (m2)':   val(cad?.almacen_trastienda, '', true),
      'Terraza propia (Superficie m2)': val(cad?.terraza_patio, '', true),
      'Equipamiento':              val(cad?.equipamiento),
      'Certificación energética':   forceCertificacion(cad?.certificado_energetico || cad?.certificacion),
      'Aforo máximo':              val(cad?.aforo_maximo, '', true),
      'Limpieza':                  val(cad?.limpieza),
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
      'Teléfonos de contacto':     val(data.from_number || data.to_number),
      'Vado (SI/NO)':              forceYesNo(cad?.vado),
      'Altura techos':             val(cad?.altura_techos),
      'Notas de Error':            !data.call_analysis?.call_successful ? val(data.call_analysis?.call_summary) : '',
      'Publicacion Autorizada?':   forceYesNo(cad?.publicacion_autorizada),
    };

    // Solo incluir columnas que existen realmente en la hoja
    const rowValue: Record<string, string> = {};
    for (const [column, value] of Object.entries(mapping)) {
      if (knownHeaders.has(column)) {
        rowValue[column] = value;
      }
    }

    this.logger.debug(`Escribiendo en Localizados para call_id ${data.call_id}`);
    await sheet.addRow(rowValue as any);
    this.logger.log(`Fila agregada correctamente en Localizados para call_id: ${data.call_id}`);
  }

  async updateRowByPhone(phoneCalled: string, data: RetellPayload, publicadoWP: string = 'NO'): Promise<void> {
    const sheet = this.doc.sheetsByTitle['Localizados'] || this.doc.sheetsByIndex[0];
    const rows = await sheet.getRows();

    // Buscar la fila correcta comparando el parámetro phoneCalled con el valor de las columnas
    const row = rows.find(r => {
      const tel1 = r.get('Teléfonos de contacto');
      const tel2 = r.get('Telefono2');
      const tel3 = r.get('Telefono3');
      return tel1 === phoneCalled || tel2 === phoneCalled || tel3 === phoneCalled;
    });

    if (!row) {
      this.logger.warn(`No se encontró ninguna fila para el teléfono: ${phoneCalled}`);
      return;
    }

    const cad = data.call_analysis?.custom_analysis_data;
    
    this.logger.log(`[updateRowByPhone] Iniciando mapeo de datos para el teléfono: ${phoneCalled}`);
    if (cad) {
      this.logger.log(`[updateRowByPhone] Datos extraídos (CAD): ${JSON.stringify(cad)}`);
    }

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

    // Funciones de validación de negocio
    const forceYesNo = (v: any) => {
      const s = String(v || '').toUpperCase().trim();
      return ['SI', 'SÍ', 'TRUE', '1', 'YES'].includes(s) ? 'SI' : 'NO';
    };

    const forceEstado = (v: any) => {
      const options = ['En construcción', 'Nuevo', 'Reformado', 'Buen estado', 'Buena conservación', 'Segunda mano - por Reformar'];
      const s = String(v || '').trim();
      const found = options.find(opt => opt.toLowerCase() === s.toLowerCase());
      return found || 'Buen estado'; // Valor por defecto
    };

    const forceCertificacion = (v: any) => {
      const options = ['No consta', 'Exento', 'En tramite', 'A', 'B', 'C', 'D', 'F', 'G'];
      const s = String(v || '').trim().toUpperCase();
      const found = options.find(opt => opt.toUpperCase() === s);
      if (found) return found;
      if (s === 'A' || s === 'B' || s === 'C' || s === 'D' || s === 'F' || s === 'G') return s;
      return 'No consta'; // Valor por defecto
    };

    const forcePublicadoPopalicer = (v: any) => {
      const options = ['Si', 'No', 'No en este momento', 'Posiblemente en un futuro', 'No estoy seguro ahora'];
      const s = String(v || '').trim();
      const found = options.find(opt => opt.toLowerCase() === s.toLowerCase());
      return found || 'No'; // Valor por defecto
    };

    // Mapeo general de campos del inmueble
    const now = new Date();
    const pad = (n: number) => n.toString().padStart(2, '0');
    const formattedDateTime = `${pad(now.getDate())}/${pad(now.getMonth() + 1)}/${now.getFullYear()} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;

    const mapping: Record<string, string> = {
      'Tipo de inmueble':          val(cad?.tipo_inmueble),
      'Disponibilidad del local':  val(cad?.disponibilidad),
      'Información adicional':     val(data.call_analysis?.call_summary || cad?.informacion_adicional),
      'Superficie Total':          val(cad?.superficie_total, '', true),
      'Superficie util':           val(cad?.superficie_util, '', true),
      'Negocio anterior':          val(cad?.negocio_anterior),
      'Estado':                    forceEstado(cad?.estado),
      'Año de construcción':       val(cad?.anio_construccion),
      'Año reforma':               val(cad?.anio_reforma),
      'Numero aseos/baños':        val(cad?.numero_banios || cad?.numero_aseos, '', true),
      'Posición exacta':           val(cad?.posicion_exacta),
      'Escaparates/ventanales':    val(cad?.escaparates),
      'Diafano?':                  val(cad?.['disposicion_diafano?'] || cad?.disposicion_diafano),
      'Eventos':                   val(cad?.eventos),
      'Almacen/trastienda (m2)':   val(cad?.almacen_trastienda, '', true),
      'Terraza propia (Superficie m2)': val(cad?.terraza_patio, '', true),
      'Equipamiento':              val(cad?.equipamiento),
      'Certificación energética':   forceCertificacion(cad?.certificado_energetico || cad?.certificacion),
      'Aforo máximo':              val(cad?.aforo_maximo, '', true),
      'Limpieza':                  val(cad?.limpieza),
      'Tipo Via':                  val(cad?.tipo_via),
      'Nombre via':                val(cad?.nombre_via),
      'Numero Via':                val(cad?.numero_via),
      'Pueblo/Barrio/distrito':    val(cad?.pueblo_barrio || cad?.pueblo),
      'Municipio':                 val(cad?.municipio),
      'Provincia':                 val(cad?.provincia),
      'Precio VENTA':              val(cad?.precio_venta, '', true),
      'Precio TRASPASO':           val(cad?.precio_traspaso, '', true),
      'Precio ALQUILER/mes':       val(cad?.precio_alquiler, '', true),
      'Fianza':                    val(cad?.fianza_meses || cad?.fianza, '', true),
      'Gastos de comunidad':       val(cad?.gastos_comunidad, '', true),
      'Negociable':                val(cad?.es_negociable),
      'Vado (SI/NO)':              forceYesNo(cad?.vado),
      'Altura techos':             val(cad?.altura_techos),
      'Nº plantas':                val(cad?.num_plantas),
      'Iluminación':               val(cad?.iluminacion),
      'Suelos':                    val(cad?.suelos),
      'Contrato':                  val(cad?.contrato),
      'Ilocalizable':              val(cad?.Ilocalizable),
      'Email propietario-gestor':  val(cad?.email_propietario_gestor || cad?.email),
      'Email Avisos':              val(cad?.email_avisos),
      'Publicacion Autorizada?':   forceYesNo(cad?.publicacion_autorizada),
      'Propietario contactado?':    data.call_analysis?.call_successful ? new Date().toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' }) : 'NO',
      'Publicado Popalicer?':      forcePublicadoPopalicer(publicadoWP),
      'Llamado FP':                'SI',
      'Fecha actualización':       formattedDateTime,
    };

    // Lógica de asignación para los bloques de contactos según cad?.target_contact
    if (cad?.target_contact === 'contacto_1') {
      mapping['Nombre contacto1'] = val(cad?.nombre_contacto_1);
      mapping['Contacto1 con'] = val(cad?.contacto_1_con);
      mapping['Contacto1 por'] = val(cad?.contacto_1_por);
    } else if (cad?.target_contact === 'contacto_2') {
      mapping['Nombre contacto2'] = val(cad?.nombre_contacto_2);
      mapping['Contacto2 con'] = val(cad?.contacto_2_con);
      mapping['Contacto2 por'] = val(cad?.contacto_2_por);
    } else if (cad?.target_contact === 'contacto_3') {
      mapping['Nombre contacto3'] = val(cad?.nombre_contacto_3);
      mapping['Contacto3 con'] = val(cad?.contacto_3_con);
      mapping['Contacto3 por'] = val(cad?.contacto_3_por);
    }

    // Aplicar los cambios a la fila de forma segura (solo si la columna existe)
    const sheetHeaders = new Set(sheet.headerValues);
    for (const [key, value] of Object.entries(mapping)) {
      if (sheetHeaders.has(key)) {
        row.set(key, value);
      } else {
        this.logger.debug(`[updateRowByPhone] Saltando columna inexistente: ${key}`);
      }
    }

    await row.save();
    this.logger.log(`Fila actualizada correctamente en Localizados para el teléfono: ${phoneCalled}`);
  }

  async testUpdateAsNewRow(data: RetellPayload, publicadoWP: string = 'NO'): Promise<void> {
    const sheet: GoogleSpreadsheetWorksheet = this.doc.sheetsByTitle['Localizados'] || this.doc.sheetsByIndex[0];
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

    // Funciones de validación de negocio
    const forceYesNo = (v: any) => {
      const s = String(v || '').toUpperCase().trim();
      return ['SI', 'SÍ', 'TRUE', '1', 'YES'].includes(s) ? 'SI' : 'NO';
    };

    const forceEstado = (v: any) => {
      const options = ['En construcción', 'Nuevo', 'Reformado', 'Buen estado', 'Buena conservación', 'Segunda mano - por Reformar'];
      const s = String(v || '').trim();
      const found = options.find(opt => opt.toLowerCase() === s.toLowerCase());
      return found || 'Buen estado'; // Valor por defecto
    };

    const forceCertificacion = (v: any) => {
      const options = ['No consta', 'Exento', 'En tramite', 'A', 'B', 'C', 'D', 'F', 'G'];
      const s = String(v || '').trim().toUpperCase();
      const found = options.find(opt => opt.toUpperCase() === s);
      if (found) return found;
      if (s === 'A' || s === 'B' || s === 'C' || s === 'D' || s === 'F' || s === 'G') return s;
      return 'No consta'; // Valor por defecto
    };

    const forcePublicadoPopalicer = (v: any) => {
      const options = ['Si', 'No', 'No en este momento', 'Posiblemente en un futuro', 'No estoy seguro ahora'];
      const s = String(v || '').trim();
      const found = options.find(opt => opt.toLowerCase() === s.toLowerCase());
      return found || 'No'; // Valor por defecto
    };

    const mapping: Record<string, string> = {
      'Llamado por':               'Localisto (TEST)',
      'Tipo de inmueble':          val(cad?.tipo_inmueble),
      'Disponibilidad del local':  val(cad?.disponibilidad),
      'Información adicional':     val(data.call_analysis?.call_summary || cad?.informacion_adicional),
      'Superficie Total':          val(cad?.superficie_total, '', true),
      'Superficie util':           val(cad?.superficie_util, '', true),
      'Negocio anterior':          val(cad?.negocio_anterior),
      'Estado':                    forceEstado(cad?.estado),
      'Año de construcción':       val(cad?.anio_construccion),
      'Año reforma':               val(cad?.anio_reforma),
      'Numero aseos/baños':        val(cad?.numero_banios || cad?.numero_aseos, '', true),
      'Posición exacta':           val(cad?.posicion_exacta),
      'Escaparates/ventanales':    val(cad?.escaparates),
      'Diafano?':                  val(cad?.disposicion_diafano),
      'Eventos':                   val(cad?.eventos),
      'Almacen/trastienda (m2)':   val(cad?.almacen_trastienda, '', true),
      'Terraza propia (Superficie m2)': val(cad?.terraza_patio, '', true),
      'Equipamiento':              val(cad?.equipamiento),
      'Certificación energética':   forceCertificacion(cad?.certificado_energetico || cad?.certificacion),
      'Aforo máximo':              val(cad?.aforo_maximo, '', true),
      'Limpieza':                  val(cad?.limpieza),
      'Tipo Via':                  val(cad?.tipo_via),
      'Nombre via':                val(cad?.nombre_via),
      'Numero Via':                val(cad?.numero_via),
      'Pueblo/Barrio/distrito':    val(cad?.pueblo_barrio || cad?.pueblo),
      'Municipio':                 val(cad?.municipio),
      'Provincia':                 val(cad?.provincia),
      'Precio VENTA':              val(cad?.precio_venta, '', true),
      'Precio TRASPASO':           val(cad?.precio_traspaso, '', true),
      'Precio ALQUILER/mes':       val(cad?.precio_alquiler, '', true),
      'Fianza':                    val(cad?.fianza_meses || cad?.fianza, '', true),
      'Gastos de comunidad':       val(cad?.gastos_comunidad, '', true),
      'Negociable':                val(cad?.es_negociable),
      'Vado (SI/NO)':              forceYesNo(cad?.vado),
      'Altura techos':             val(cad?.altura_techos),
      'Propietario contactado?':    data.call_analysis?.call_successful ? new Date().toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' }) : 'NO',
      'Publicado Popalicer?':      forcePublicadoPopalicer(publicadoWP),
      'Publicacion Autorizada?':   forceYesNo(cad?.publicacion_autorizada),
      'Contrato':                  val(cad?.contrato),
      'Ilocalizable':              val(cad?.Ilocalizable),
      'Email propietario-gestor':  val(cad?.email_propietario_gestor || cad?.email),
      'Email Avisos':              val(cad?.email_avisos),
      'Fecha actualización':       new Date().toLocaleString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).replace(',', ''),
      'Teléfonos de contacto':     val(data.from_number || data.to_number),
    };

    // Lógica de asignación para los bloques de contactos según cad?.target_contact
    if (cad?.target_contact === 'contacto_1') {
      mapping['Nombre contacto1'] = val(cad?.nombre_contacto_1);
      mapping['Contacto1 con'] = val(cad?.contacto_1_con);
      mapping['Contacto1 por'] = val(cad?.contacto_1_por);
    } else if (cad?.target_contact === 'contacto_2') {
      mapping['Nombre contacto2'] = val(cad?.nombre_contacto_2);
      mapping['Contacto2 con'] = val(cad?.contacto_2_con);
      mapping['Contacto2 por'] = val(cad?.contacto_2_por);
    } else if (cad?.target_contact === 'contacto_3') {
      mapping['Nombre contacto3'] = val(cad?.nombre_contacto_3);
      mapping['Contacto3 con'] = val(cad?.contacto_3_con);
      mapping['Contacto3 por'] = val(cad?.contacto_3_por);
    }

    const rowValue: Record<string, string> = {};
    for (const [column, value] of Object.entries(mapping)) {
      if (knownHeaders.has(column)) {
        rowValue[column] = value;
      }
    }

    await sheet.addRow(rowValue as any);
    this.logger.log(`Fila de TEST agregada correctamente en Localizados para call_id: ${data.call_id}`);
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
      target_contact?: string;
      publicacion_autorizada?: string;
      contrato?: string;
      Ilocalizable?: string;
      email_avisos?: string;
      nombre_contacto_1?: string;
      nombre_contacto_2?: string;
      nombre_contacto_3?: string;
      contacto_1_con?: string;
      contacto_2_con?: string;
      contacto_3_con?: string;
      contacto_1_por?: string;
      contacto_2_por?: string;
      contacto_3_por?: string;
      telefono_contacto_1?: string;
      telefono_contacto_2?: string;
      telefono_contacto_3?: string;
      email_propietario_gestor?: string;
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
      contacto_preferido?: string;
      email?: string;
      informacion_adicional?: string;
      numero_aseos?: string;
      numero_via?: string;
      pueblo_barrio?: string;
      fianza_meses?: string;
      posicion_exacta?: string;
      numero_banios?: string;
      escaparates?: string;
      'disposicion_diafano?'?: string;
      disposicion_diafano?: string;
      eventos?: string;
      almacen_trastienda?: string;
      terraza_patio?: string;
      equipamiento?: string;
      certificado_energetico?: string;
      aforo_maximo?: string;
      limpieza?: string;
    };
  };
}
