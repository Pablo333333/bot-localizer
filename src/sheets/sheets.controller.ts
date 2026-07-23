import { Body, Controller, Logger, Post } from '@nestjs/common';
import { SheetsService } from './sheets.service';
import { WordpressService } from '../wordpress/wordpress.service';
import { GoogleDriveService } from '../google/google-drive.service';
import { ConfigService } from '@nestjs/config';

@Controller('webhooks')
export class SheetsController {
  private readonly logger = new Logger(SheetsController.name);

  constructor(
    private readonly sheetsService: SheetsService,
    private readonly wordpressService: WordpressService,
    private readonly googleDriveService: GoogleDriveService,
    private readonly configService: ConfigService,
  ) {
    this.verifyDocAccess();
  }

  private verifyDocAccess(): void {
    const doc = this.sheetsService.getDoc();
    this.logger.log(
      `[verifyDocAccess] Documento accesible desde el controlador: ${doc?.title ?? 'aún no cargado'}`,
    );
  }

  @Post('retell')
  async handleRetellWebhook(@Body() body: Record<string, any>): Promise<void> {
    this.logger.log('Cuerpo del webhook recibido:');
    console.log(JSON.stringify(body, null, 2));

    const eventType = body.event_type || body.event;
    
    // Solo procesar si el evento es 'call_analyzed'
    if (eventType !== 'call_analyzed') {
      this.logger.log(`Ignorando evento de tipo: ${eventType}. Solo se procesa 'call_analyzed'.`);
      return;
    }

    const callData = (body.call || body) as any;
    const agentId = callData.agent_id;
    const callId = callData.call_id;

    // 1. Contexto de Identidad: Solo procesar para el Agente Outbound ID específico
    const TARGET_AGENT_ID = this.configService.get<string>('RETELL_OUTBOUND_AGENT_ID') || 'agent_b8abf941c156192b1995f36c5d';
    const INBOUND_AGENT_ID = this.configService.get<string>('RETELL_INBOUND_AGENT_ID');

    if (agentId !== TARGET_AGENT_ID && agentId !== INBOUND_AGENT_ID) {
      this.logger.warn(`Ignorando webhook: Agent ID ${agentId} no coincide con objetivos.`);
      return;
    }

    const cad = callData.call_analysis?.custom_analysis_data;
    const callSummary = callData.call_analysis?.call_summary || '';
    
    // Logging detallado de campos extraídos por la IA
    if (cad) {
      this.logger.log(`[IA Data Extraction] Campos detectados para Call ID ${callId}:`);
      Object.entries(cad).forEach(([key, value]) => {
        console.log(`  - ${key}: ${value}`);
      });
    } else {
      this.logger.warn(`[IA Data Extraction] No se detectó custom_analysis_data para Call ID ${callId}`);
    }
    
    // Flexibilización de call_successful: Si no viene, validamos por longitud del resumen
    let isSuccessful = callData.call_analysis?.call_successful === true;
    if (callData.call_analysis?.call_successful === undefined || callData.call_analysis?.call_successful === null) {
      isSuccessful = callSummary.length > 50;
      this.logger.log(`call_successful no detectado. Validando por resumen (>50 chars): ${isSuccessful} (${callSummary.length} chars)`);
    }

    // Flexibilización de "Disponible"
    const dispValue = String(cad?.disponibilidad || '').toUpperCase().trim();
    const isAvailable = ['DISPONIBLE', 'SÍ', 'SI', 'TRUE', 'YES'].includes(dispValue);

    this.logger.log(`Procesando webhook para Agent ID: ${agentId}. Éxito: ${isSuccessful}, Disponible: ${isAvailable} (Valor original: ${cad?.disponibilidad})`);

    try {
      let publicadoWordpress = 'NO';
      
      // 2. Filtro de Éxito y Disponibilidad para WordPress
      if (isSuccessful && isAvailable) {
        try {
          this.logger.log('Iniciando flujo WordPress (Llamada Exitosa y Disponible)...');
          let featuredMediaId: number | undefined;
          const rootFolderId = this.configService.get<string>('DRIVE_ROOT_FOLDER_ID');
          
          if (rootFolderId && callId) {
            try {
              this.logger.log(`Buscando imágenes en Drive para call_id: ${callId}`);
              let images = await this.googleDriveService.getImagesFromFolder(rootFolderId, callId);
              
              // Fallback 1: Buscar por municipio si no hay por call_id
              if (images.length === 0 && cad?.municipio) {
                this.logger.log(`No se encontró imagen para call_id ${callId}. Intentando fallback por municipio: ${cad.municipio}`);
                images = await this.googleDriveService.getImagesFromFolder(rootFolderId, cad.municipio);
              }

              // Fallback 2: Buscar por tipo de inmueble si sigue sin haber imágenes
              if (images.length === 0 && cad?.tipo_inmueble) {
                this.logger.log(`No se encontró imagen por municipio. Intentando fallback por tipo: ${cad.tipo_inmueble}`);
                images = await this.googleDriveService.getImagesFromFolder(rootFolderId, cad.tipo_inmueble);
              }

              // Fallback 3: Si no hay nada, traer cualquier imagen de la carpeta raíz
              if (images.length === 0) {
                this.logger.log('No se encontraron imágenes con criterios específicos. Trayendo imagen genérica de la raíz.');
                images = await this.googleDriveService.getImagesFromFolder(rootFolderId);
              }
              
              if (images.length > 0) {
                this.logger.log(`Imagen seleccionada: ${images[0].name}. Descargando...`);
                const buffer = await this.googleDriveService.downloadImageBuffer(images[0].id!);
                featuredMediaId = await this.wordpressService.uploadMedia(buffer, images[0].name || `call_${callId}.jpg`);
              }
            } catch (driveError) {
              this.logger.error(`Error en Drive: ${driveError.message}`);
            }
          }

          await this.wordpressService.createPropertyPost(callData, featuredMediaId);
          publicadoWordpress = 'SI';
        } catch (wpError) {
          this.logger.error(`Error en WordPress: ${wpError.message}`);
        }
      } else {
        this.logger.log(`No se cumple el criterio para WordPress (Éxito: ${isSuccessful}, Disponible: ${isAvailable}). Solo se guardará en Sheets.`);
      }

      // 3. Guardar en Google Sheets (Siempre se intenta si el Agent ID es correcto)
      // Outbound: buscar SIEMPRE por to_number (destinatario). Nunca usar from_number
      // (nuestro número Retell, p.ej. +34871075112).
      this.logger.log('Guardando datos en Google Sheets (Actualizando fila existente)...');
      const phoneCalled = callData.to_number || '';
      if (!phoneCalled) {
        this.logger.warn(
          `[Webhook] Call ${callId}: to_number vacío; no se puede localizar la fila en Sheets.`,
        );
        return;
      }
      this.logger.log(`[Webhook] Buscando fila por to_number (destinatario): ${phoneCalled}`);
      await this.sheetsService.updateRowByPhone(phoneCalled, callData, publicadoWordpress);

    } catch (error) {
      const destNum = callData.to_number || 'unknown';
      this.logger.error(`[Webhook Error] Call ${callId} to ${destNum}: ${error.message}`, error.stack);
    }
  }
}
