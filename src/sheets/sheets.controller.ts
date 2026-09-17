import { Body, Controller, Logger, Post } from '@nestjs/common';
import { SheetsService } from './sheets.service';
import { WordpressService } from '../wordpress/wordpress.service';
import { ConfigService } from '@nestjs/config';
import { preferCallCad } from '../wordpress/call-cad-priority';
import { CommercialDescriptionService } from '../wordpress/commercial-description.service';
import { PropertyMediaService } from '../wordpress/property-media.service';
import {
  COL_DESCRIPCION_PROPIETARIO,
  COL_DESCRIPCION_PROPIETARIO_ALT,
} from '../wordpress/wpresidence.constants';
import { PropertyPublishEmailService } from '../notifications/property-publish-email.service';
import { NoAnswerFollowupService } from '../nurturing/followup/no-answer-followup.service';
import { resolveRetellLeadPhone } from '../nurturing/followup/retell-call-phone';
import {
  PHASE3_TONI_PHONE_E164,
  isPhase3AllowedPhone,
} from '../nurturing/phase3-allowlist';

@Controller('webhooks')
export class SheetsController {
  private readonly logger = new Logger(SheetsController.name);

  constructor(
    private readonly sheetsService: SheetsService,
    private readonly wordpressService: WordpressService,
    private readonly propertyMedia: PropertyMediaService,
    private readonly configService: ConfigService,
    private readonly propertyPublishEmail: PropertyPublishEmailService,
    private readonly noAnswerFollowup: NoAnswerFollowupService,
    private readonly commercialDescription: CommercialDescriptionService,
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

    // call_analyzed: flujo completo (CAD + WP + nurturing).
    // call_ended: nurturing temprano si no-contesta/busy/hangup (Retell a veces tarda el analyzed).
    if (eventType !== 'call_analyzed' && eventType !== 'call_ended') {
      this.logger.log(
        `Ignorando evento de tipo: ${eventType}. Solo se procesan 'call_analyzed' y 'call_ended'.`,
      );
      return;
    }

    const callData = (body.call || body) as any;
    const agentId =
      callData.agent_id ||
      callData.agentId ||
      body.agent_id ||
      body.call?.agent_id;
    const callId = callData.call_id || body.call_id;
    const leadPhone = resolveRetellLeadPhone(callData, body);

    const TARGET_AGENT_ID =
      this.configService.getOrThrow<string>('RETELL_OUTBOUND_AGENT_ID');
    const INBOUND_AGENT_ID = this.configService.get<string>(
      'RETELL_INBOUND_AGENT_ID',
    );
    const FOLLOWUP_AGENT_ID =
      this.configService.get<string>('RETELL_AGENT_ID_FOLLOWUP') ||
      'agent_25c341a3bcc06e505b5ed2850c';

    const agentMatch =
      agentId === TARGET_AGENT_ID ||
      agentId === INBOUND_AGENT_ID ||
      agentId === FOLLOWUP_AGENT_ID;

    /** Fase 3 solo Toni: nurturing aunque agent_id no matchee (llamada manual). */
    const phase3Toni =
      Boolean(leadPhone) &&
      isPhase3AllowedPhone(
        leadPhone,
        this.configService.get('NURTURING_PHASE3_PHONE_ALLOWLIST'),
      );

    if (!agentMatch && !phase3Toni) {
      this.logger.warn(
        `[WEBHOOK_GATE] SKIP agent_mismatch agent=${agentId} phone=${leadPhone || '(vacío)'} ` +
          `outbound=${TARGET_AGENT_ID} followup=${FOLLOWUP_AGENT_ID} inbound=${INBOUND_AGENT_ID || 'n/a'} ` +
          `→ sin nurturing / sin enroll BullMQ.`,
      );
      return;
    }

    if (!agentMatch && phase3Toni) {
      this.logger.warn(
        `[WEBHOOK_GATE] agent_mismatch PERO Fase3 Toni phone=${leadPhone} ` +
          `agent=${agentId} — nurturing permitido (allowlist ${PHASE3_TONI_PHONE_E164}).`,
      );
    }

    const shouldNurture =
      agentId === TARGET_AGENT_ID ||
      agentId === FOLLOWUP_AGENT_ID ||
      phase3Toni;

    // Nurturing en call_ended y call_analyzed (idempotente por call_id).
    // Internamente NoAnswerFollowupService vuelve a filtrar allowlist Toni.
    if (shouldNurture) {
      try {
        if (!callData.agent_id && agentId) {
          callData.agent_id = agentId;
        }
        if (
          phase3Toni &&
          callData.agent_id !== TARGET_AGENT_ID &&
          callData.agent_id !== FOLLOWUP_AGENT_ID
        ) {
          callData.agent_id = TARGET_AGENT_ID;
        }
        if (!callData.to_number && leadPhone) {
          callData.to_number = leadPhone;
        }

        this.logger.log(
          `[WEBHOOK_GATE] nurturing START event=${eventType} call=${callId} ` +
            `agent=${callData.agent_id} phone=${leadPhone} reason=${callData.disconnection_reason || callData.call_status || '?'}`,
        );

        const followup =
          await this.noAnswerFollowup.handleOutboundCallAnalyzed(callData, {
            eventType: String(eventType),
          });
        this.logger.log(
          `[WEBHOOK_GATE] nurturing DONE event=${eventType} phase=${followup.phase} outcome=${followup.outcome} ` +
            `wa=${followup.whatsappSent} sms=${followup.smsSent} enroll=${followup.enrolled} ` +
            `ilocalizable=${followup.markedIlocalizable} lead=${followup.leadId}`,
        );
      } catch (followErr: any) {
        this.logger.error(
          `[WEBHOOK_GATE] nurturing ERROR: ${followErr.message}`,
          followErr.stack,
        );
      }
    } else {
      this.logger.log(
        `[WEBHOOK_GATE] nurturing omitted (inbound-only agent=${agentId})`,
      );
    }

    // Sheets / WordPress solo con análisis completo
    if (eventType !== 'call_analyzed') {
      this.logger.log(
        `Evento ${eventType} — nurturing aplicado; se omite sync Sheets/WP hasta call_analyzed.`,
      );
      return;
    }

    const cad = this.mergeCallCadSources(callData);
    const callSummary = callData.call_analysis?.call_summary || '';

    if (cad && Object.keys(cad).length > 0) {
      this.logger.log(
        `[IA Data Extraction] Campos detectados para Call ID ${callId}:`,
      );
      Object.entries(cad).forEach(([key, value]) => {
        console.log(`  - ${key}: ${value}`);
      });
    } else {
      this.logger.warn(
        `[IA Data Extraction] No se detectó CAD (custom_analysis / collected / llm vars) para Call ID ${callId}`,
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

    try {
      let publicadoWordpress: string | undefined;
      let wpPostId: number | string | undefined;

      const phoneCalled = callData.to_number || '';
      if (!phoneCalled) {
        this.logger.warn(
          `[Webhook] Call ${callId}: to_number vacío; no se puede localizar la fila en Sheets.`,
        );
        return;
      }

      this.logger.log(
        `[Webhook] Escritura Sheets ANTES de WP — buscando fila por to_number: ${phoneCalled}`,
      );

      const sheetWrite = await this.sheetsService.writeCallPropertyUpdates(
        phoneCalled,
        cad,
      );
      if (!sheetWrite.found) {
        this.logger.warn(
          `[Webhook] Call ${callId}: no hay fila en Localizados para ${phoneCalled}. No se publica WP para no perder el dato en un refresh posterior.`,
        );
        return;
      }

      const mergedCad = preferCallCad(sheetWrite.sheetCad, cad);
      if (callData.call_analysis) {
        callData.call_analysis.custom_analysis_data = mergedCad;
      }

      const dispValue = String(mergedCad.disponibilidad || cad?.disponibilidad || '')
        .toUpperCase()
        .trim();
      const isAvailable = ['DISPONIBLE', 'SÍ', 'SI', 'TRUE', 'YES'].includes(
        dispValue,
      );
      this.logger.log(
        `Procesando webhook para Agent ID: ${agentId}. Éxito: ${isSuccessful}, Disponible: ${isAvailable} (Valor: ${mergedCad.disponibilidad || cad?.disponibilidad})`,
      );

      const commercialContent = await this.commercialDescription.resolve(
        mergedCad,
        callSummary,
      );
      mergedCad.descripcion_propietario = commercialContent;

      if (sheetWrite.sheet && sheetWrite.rowNumber) {
        await this.sheetsService.updateSpecificCells(
          sheetWrite.sheet,
          sheetWrite.rowNumber,
          {
            [COL_DESCRIPCION_PROPIETARIO]: commercialContent,
            [COL_DESCRIPCION_PROPIETARIO_ALT]: commercialContent,
          },
        );
      }

      if (isSuccessful && isAvailable) {
        try {
          this.logger.log(
            'Iniciando flujo WordPress con CAD de llamada (Sheet ya actualizado)...',
          );
          const existingPostId = sheetWrite.wpPostId;

          if (existingPostId) {
            const brief =
              await this.wordpressService.getEstatePropertyBrief(existingPostId);
            const protect = !['false', '0', 'no', 'off'].includes(
              String(
                this.configService.get('WP_SYNC_PROTECT_PUBLISHED') ?? 'true',
              )
                .trim()
                .toLowerCase(),
            );
            if (protect && brief?.status === 'publish') {
              this.logger.warn(
                `Webhook Retell: post ${existingPostId} ya publicado — no se sobrescribe WP (Sheet sí se actualizó). Usa Forzar sync WP=SI o ?force=1.`,
              );
              publicadoWordpress = 'SI';
              wpPostId = existingPostId;
            } else {
              const media =
                await this.propertyMedia.resolveAndUploadPropertyMedia(
                  mergedCad,
                  callId,
                  { postId: existingPostId },
                );
              const upserted =
                await this.wordpressService.upsertPropertyFromCallData(
                  callData,
                  {
                    postId: existingPostId,
                    featuredMediaId: media.featuredMediaId,
                    galleryMediaIds: media.galleryMediaIds,
                    commercialContent,
                    preserveStatus: brief?.status === 'publish',
                  },
                );
              if (media.galleryMediaIds.length > 0) {
                await this.propertyMedia.attachGalleryToProperty(
                  upserted.id,
                  media.galleryMediaIds,
                );
              }
              publicadoWordpress = 'SI';
              wpPostId = upserted.id;
            }
          } else {
            const media =
              await this.propertyMedia.resolveAndUploadPropertyMedia(
                mergedCad,
                callId,
              );
            const upserted =
              await this.wordpressService.upsertPropertyFromCallData(
                callData,
                {
                  featuredMediaId: media.featuredMediaId,
                  galleryMediaIds: media.galleryMediaIds,
                  commercialContent,
                },
              );
            if (media.galleryMediaIds.length > 0) {
              await this.propertyMedia.attachGalleryToProperty(
                upserted.id,
                media.galleryMediaIds,
              );
            }
            publicadoWordpress = 'SI';
            wpPostId = upserted.id;
          }

          const propertyTitle = `Inmueble ${wpPostId}`;
          const propertyUrl = wpPostId
            ? `${this.configService.get('WP_URL')?.replace(/\/$/, '')}/?p=${wpPostId}`
            : undefined;

          const notifyTo =
            mergedCad?.email_avisos ||
            mergedCad?.email_propietario_gestor ||
            mergedCad?.email ||
            this.configService.get<string>('PROPERTY_PUBLISH_NOTIFY_TO') ||
            'somos@localicer.com';

          if (propertyUrl && wpPostId) {
            await this.propertyPublishEmail.sendPropertyPublishedEmail({
              to: String(notifyTo),
              propertyTitle,
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
          `No se cumple el criterio para WordPress (Éxito: ${isSuccessful}, Disponible: ${isAvailable}). Sheet ya tiene el dato de la llamada.`,
        );
      }

      this.logger.log(
        'Escribiendo tracking de llamada en Google Sheets...',
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

  /**
   * Une todas las fuentes Retell donde Localisto deja correcciones:
   * custom_analysis_data + collected_dynamic_variables + retell_llm_dynamic_variables.
   * El análisis custom gana sobre collected; collected gana sobre llm iniciales.
   */
  private mergeCallCadSources(callData: Record<string, any>): Record<string, any> {
    const llm = callData.retell_llm_dynamic_variables || {};
    const collected = callData.collected_dynamic_variables || {};
    const analysis = callData.call_analysis?.custom_analysis_data || {};
    const merged = {
      ...llm,
      ...collected,
      ...analysis,
    };
    if (!callData.call_analysis) {
      callData.call_analysis = {};
    }
    callData.call_analysis.custom_analysis_data = merged;
    return merged;
  }
}
