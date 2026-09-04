import { Body, Controller, Logger, Post } from '@nestjs/common';
import { SheetsService } from './sheets.service';
import { WordpressService } from '../wordpress/wordpress.service';
import { GoogleDriveService } from '../google/google-drive.service';
import { ConfigService } from '@nestjs/config';
import { extractImageUrlFromCad } from '../wordpress/property-mapper';
import { PropertyPublishEmailService } from '../notifications/property-publish-email.service';
import { NoAnswerFollowupService } from '../nurturing/followup/no-answer-followup.service';

@Controller('webhooks')
export class SheetsController {
  private readonly logger = new Logger(SheetsController.name);

  constructor(
    private readonly sheetsService: SheetsService,
    private readonly wordpressService: WordpressService,
    private readonly googleDriveService: GoogleDriveService,
    private readonly configService: ConfigService,
    private readonly propertyPublishEmail: PropertyPublishEmailService,
    private readonly noAnswerFollowup: NoAnswerFollowupService,
  ) {
    this.verifyDocAccess();
  }

  private verifyDocAccess(): void {
    const doc = this.sheetsService.getDoc();
    this.logger.log(
      `[verifyDocAccess] Documento accesible desde el controlador: ${doc?.title ?? 'aún no cargado'}`,
    );
  }

  /**
   * Resuelve imagen destacada: 1) URL Drive en el CAD, 2) búsqueda en carpeta Drive.
   */
  private async resolveFeaturedMediaId(
    cad: Record<string, unknown> | undefined,
    callId: string | undefined,
  ): Promise<number | undefined> {
    const imageUrl = extractImageUrlFromCad(cad);
    if (imageUrl) {
      try {
        this.logger.log(`Imagen desde URL del registro: ${imageUrl}`);
        const { buffer, fileName, mimeType } =
          await this.googleDriveService.downloadImageFromUrl(imageUrl);
        return await this.wordpressService.uploadMedia(
          buffer,
          fileName || `call_${callId || 'img'}.jpg`,
          mimeType,
        );
      } catch (urlErr: any) {
        this.logger.error(
          `Error descargando imagen por URL Drive: ${urlErr.message}. Se intenta fallback por carpeta.`,
        );
      }
    }

    const rootFolderId = this.configService.get<string>('DRIVE_ROOT_FOLDER_ID');
    if (!rootFolderId || !callId) {
      return undefined;
    }

    try {
      this.logger.log(`Buscando imágenes en Drive para call_id: ${callId}`);
      let images = await this.googleDriveService.getImagesFromFolder(
        rootFolderId,
        callId,
      );

      if (images.length === 0 && cad?.municipio) {
        this.logger.log(
          `No se encontró imagen para call_id ${callId}. Fallback municipio: ${cad.municipio}`,
        );
        images = await this.googleDriveService.getImagesFromFolder(
          rootFolderId,
          String(cad.municipio),
        );
      }

      if (images.length === 0 && cad?.tipo_inmueble) {
        this.logger.log(
          `Fallback por tipo de inmueble: ${cad.tipo_inmueble}`,
        );
        images = await this.googleDriveService.getImagesFromFolder(
          rootFolderId,
          String(cad.tipo_inmueble),
        );
      }

      if (images.length === 0) {
        this.logger.log(
          'Sin coincidencias; usando primera imagen de la carpeta raíz.',
        );
        images = await this.googleDriveService.getImagesFromFolder(rootFolderId);
      }

      if (images.length > 0) {
        this.logger.log(`Imagen seleccionada: ${images[0].name}. Descargando...`);
        const buffer = await this.googleDriveService.downloadImageBuffer(
          images[0].id!,
        );
        return await this.wordpressService.uploadMedia(
          buffer,
          images[0].name || `call_${callId}.jpg`,
        );
      }
    } catch (driveError: any) {
      this.logger.error(`Error en Drive: ${driveError.message}`);
    }

    return undefined;
  }

  @Post('retell')
  async handleRetellWebhook(@Body() body: Record<string, any>): Promise<void> {
    this.logger.log('Cuerpo del webhook recibido:');
    console.log(JSON.stringify(body, null, 2));

    const eventType = body.event_type || body.event;

    // call_analyzed: flujo completo (CAD + WP + nurturing).
    // call_ended: nurturing temprano si no-contesta/busy/hangup (Retell a veces tarda el analyzed).
    if (eventType !== 'call_analyzed' && eventType !== 'call_ended') {
      this.logger.log(
        `Ignorando evento de tipo: ${eventType}. Solo se procesan 'call_analyzed' y 'call_ended'.`,
      );
      return;
    }

    const callData = (body.call || body) as any;
    const agentId = callData.agent_id;
    const callId = callData.call_id;

    const TARGET_AGENT_ID =
      this.configService.getOrThrow<string>('RETELL_OUTBOUND_AGENT_ID');
    const INBOUND_AGENT_ID = this.configService.get<string>(
      'RETELL_INBOUND_AGENT_ID',
    );
    const FOLLOWUP_AGENT_ID =
      this.configService.get<string>('RETELL_AGENT_ID_FOLLOWUP') ||
      'agent_25c341a3bcc06e505b5ed2850c';

    if (
      agentId !== TARGET_AGENT_ID &&
      agentId !== INBOUND_AGENT_ID &&
      agentId !== FOLLOWUP_AGENT_ID
    ) {
      this.logger.warn(
        `Ignorando webhook: Agent ID ${agentId} no coincide con objetivos.`,
      );
      return;
    }

    // Nurturing en call_ended y call_analyzed (idempotente por call_id).
    if (agentId === TARGET_AGENT_ID || agentId === FOLLOWUP_AGENT_ID) {
      try {
        const followup =
          await this.noAnswerFollowup.handleOutboundCallAnalyzed(callData, {
            eventType: String(eventType),
          });
        this.logger.log(
          `Nurturing follow-up (${eventType}): phase=${followup.phase} outcome=${followup.outcome} wa=${followup.whatsappSent} sms=${followup.smsSent} enroll=${followup.enrolled} ilocalizable=${followup.markedIlocalizable} lead=${followup.leadId}`,
        );
      } catch (followErr: any) {
        this.logger.error(
          `Nurturing follow-up error: ${followErr.message}`,
          followErr.stack,
        );
      }
    }

    // Sheets / WordPress solo con análisis completo
    if (eventType !== 'call_analyzed') {
      this.logger.log(
        `Evento ${eventType} — nurturing aplicado; se omite sync Sheets/WP hasta call_analyzed.`,
      );
      return;
    }

    const cad = callData.call_analysis?.custom_analysis_data;
    const callSummary = callData.call_analysis?.call_summary || '';

    if (cad) {
      this.logger.log(
        `[IA Data Extraction] Campos detectados para Call ID ${callId}:`,
      );
      Object.entries(cad).forEach(([key, value]) => {
        console.log(`  - ${key}: ${value}`);
      });
    } else {
      this.logger.warn(
        `[IA Data Extraction] No se detectó custom_analysis_data para Call ID ${callId}`,
      );
    }

    let isSuccessful = callData.call_analysis?.call_successful === true;
    if (
      callData.call_analysis?.call_successful === undefined ||
      callData.call_analysis?.call_successful === null
    ) {
      isSuccessful = callSummary.length > 50;
      this.logger.log(
        `call_successful no detectado. Validando por resumen (>50 chars): ${isSuccessful} (${callSummary.length} chars)`,
      );
    }

    const dispValue = String(cad?.disponibilidad || '')
      .toUpperCase()
      .trim();
    const isAvailable = ['DISPONIBLE', 'SÍ', 'SI', 'TRUE', 'YES'].includes(
      dispValue,
    );

    this.logger.log(
      `Procesando webhook para Agent ID: ${agentId}. Éxito: ${isSuccessful}, Disponible: ${isAvailable} (Valor original: ${cad?.disponibilidad})`,
    );

    try {
      let publicadoWordpress: string | undefined;
      let wpPostId: number | string | undefined;

      if (isSuccessful && isAvailable) {
        try {
          this.logger.log(
            'Iniciando flujo WordPress (Llamada Exitosa y Disponible)...',
          );
          const featuredMediaId = await this.resolveFeaturedMediaId(
            cad,
            callId,
          );
          const created = await this.wordpressService.createPropertyPost(
            callData,
            featuredMediaId,
          );
          publicadoWordpress = 'SI';
          wpPostId = created?.id;

          const propertyTitle =
            typeof created?.title === 'object'
              ? created.title?.rendered
              : created?.title;
          const propertyUrl =
            created?.link ||
            (created?.id
              ? `${this.configService.get('WP_URL')?.replace(/\/$/, '')}/?p=${created.id}`
              : undefined);

          const notifyTo =
            cad?.email_avisos ||
            cad?.email_propietario_gestor ||
            cad?.email ||
            this.configService.get<string>('PROPERTY_PUBLISH_NOTIFY_TO') ||
            'somos@localicer.com';

          if (propertyUrl) {
            await this.propertyPublishEmail.sendPropertyPublishedEmail({
              to: String(notifyTo),
              propertyTitle: propertyTitle || 'Anuncio Localicer',
              propertyUrl,
              callId,
            });
          }
        } catch (wpError: any) {
          this.logger.error(`Error en WordPress: ${wpError.message}`);
          publicadoWordpress = 'NO';
        }
      } else {
        this.logger.log(
          `No se cumple el criterio para WordPress (Éxito: ${isSuccessful}, Disponible: ${isAvailable}). Se actualizará tracking y celdas de inmueble solo si Retell trajo datos nuevos.`,
        );
      }

      this.logger.log(
        'Guardando datos en Google Sheets (Actualizando fila existente)...',
      );
      const phoneCalled = callData.to_number || '';
      if (!phoneCalled) {
        this.logger.warn(
          `[Webhook] Call ${callId}: to_number vacío; no se puede localizar la fila en Sheets.`,
        );
        return;
      }
      this.logger.log(
        `[Webhook] Buscando fila por to_number (destinatario): ${phoneCalled}`,
      );
      await this.sheetsService.updateRowByPhone(
        phoneCalled,
        callData,
        publicadoWordpress,
        wpPostId,
      );
    } catch (error: any) {
      const destNum = callData.to_number || 'unknown';
      this.logger.error(
        `[Webhook Error] Call ${callId} to ${destNum}: ${error.message}`,
        error.stack,
      );
    }
  }
}
