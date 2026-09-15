import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Channel as PrismaChannel } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SmsChannel } from '../channels/sms.channel';
import { WhatsappChannel } from '../channels/whatsapp.channel';
import { EnrollmentsService } from '../enrollments/enrollments.service';
import { LeadStatus } from '../enums';
import { CallOutcome } from '../enums/lead-status.enum';
import { LeadsService } from '../leads/leads.service';
import {
  TEMPLATE_SMS_T0,
  TEMPLATE_SMS_T7,
  TEMPLATE_WA_T0,
  TONI_BOOKING_LINK,
  TONI_NO_ANSWER_MESSAGE,
  TWILIO_CONTENT_SID_SEGUIMIENTO_FASE3,
  resolveCallPhase,
  resolveRetellFollowupAgentId,
  type NurturingCallPhase,
} from '../toni-fase3.constants';
import {
  NURTURING_PHASE3_DISABLED_LOG,
  isNurturingPhase3Enabled,
} from '../phase3-enabled';
import { normalizePhone, formatE164Spain } from '../utils/phone.util';
import {
  OUTBOUND_SANDBOX_WHITELIST_E164,
  OUTBOUND_SANDBOX_WHITELIST_ENABLED,
  isAllowedOutboundSandboxPhone,
} from '../../outbound/outbound-sandbox-whitelist';
import { CallOutcomeClassifier } from './call-outcome.classifier';
import { planNoContactFollowup, resolveT0MessageChannel } from './no-answer-followup.policy';
import {
  buildSeguimientoSmsContentVariables,
  resolveLeadContactName,
  resolveLeadPropertyLabel,
} from './lead-sms-content-vars';

/**
 * Retell outbound / follow-up:
 * - Crea Lead si el teléfono no existe.
 * - NO_ANSWER / POSTPONE (/ busy / voicemail / user_declined): SMS T+0
 *   (Content SID seguimiento_lead_fase3) + enroll T+7/T+10 + PENDIENTE.
 *   WhatsApp solo si NURTURING_WHATSAPP_ENABLED=true y canal lo pide.
 * - HANGUP u otras casuísticas: PENDIENTE, sin cola T+7/T+10.
 * - T+7: SMS si la rellamada no contacta. T+10: ILOCALIZABLE.
 */
@Injectable()
export class NoAnswerFollowupService {
  private readonly logger = new Logger(NoAnswerFollowupService.name);

  constructor(
    private readonly classifier: CallOutcomeClassifier,
    private readonly whatsapp: WhatsappChannel,
    private readonly sms: SmsChannel,
    private readonly prisma: PrismaService,
    private readonly enrollments: EnrollmentsService,
    private readonly leads: LeadsService,
    private readonly config: ConfigService,
  ) {}

  async handleOutboundCallAnalyzed(
    callData: Record<string, any>,
    options?: { eventType?: string },
  ): Promise<{
    outcome: CallOutcome;
    phase: NurturingCallPhase;
    whatsappSent: boolean;
    smsSent: boolean;
    enrolled: boolean;
    markedIlocalizable: boolean;
    leadId?: string;
  }> {
    if (
      !isNurturingPhase3Enabled(this.config.get('NURTURING_PHASE3_ENABLED'))
    ) {
      this.logger.log(NURTURING_PHASE3_DISABLED_LOG);
      return {
        outcome: CallOutcome.UNKNOWN,
        phase: 'unknown',
        whatsappSent: false,
        smsSent: false,
        enrolled: false,
        markedIlocalizable: false,
      };
    }

    // call_ended prematuro: nurturing si no-conexión clara O user_hangup
    if (
      options?.eventType === 'call_ended' &&
      !this.classifier.isClearNoContactBeforeAnalysis(callData)
    ) {
      this.logger.log(
        `call_ended sin no-contacto/hangup claro (reason=${callData.disconnection_reason || callData.call_status || '?'}) — se espera call_analyzed`,
      );
      return {
        outcome: CallOutcome.UNKNOWN,
        phase: 'unknown',
        whatsappSent: false,
        smsSent: false,
        enrolled: false,
        markedIlocalizable: false,
      };
    }

    const outcome = this.classifier.classify(callData);
    const enrollRetry = this.classifier.shouldEnrollRetrySequence(outcome);
    const markPendiente = this.classifier.shouldMarkPendiente(outcome);
    this.logger.log(
      `[Followup] outcome=${outcome} enrollRetry=${enrollRetry} pendiente=${markPendiente} call=${callData.call_id}`,
    );
    const phoneRaw = callData.to_number || '';
    if (!phoneRaw) {
      this.logger.warn('No to_number on call — skip follow-up');
      return {
        outcome,
        phase: 'unknown',
        whatsappSent: false,
        smsSent: false,
        enrolled: false,
        markedIlocalizable: false,
      };
    }

    // Prueba Toni: sandbox activo → ignorar SMS/enroll de cualquier otro número.
    if (
      OUTBOUND_SANDBOX_WHITELIST_ENABLED &&
      !isAllowedOutboundSandboxPhone(phoneRaw)
    ) {
      this.logger.warn(
        `[Followup] SKIP sandbox — to=${phoneRaw} (solo ${OUTBOUND_SANDBOX_WHITELIST_E164}) call=${callData.call_id}`,
      );
      return {
        outcome,
        phase: 'unknown',
        whatsappSent: false,
        smsSent: false,
        enrolled: false,
        markedIlocalizable: false,
      };
    }

    const lead = await this.findOrCreateLeadFromCall(phoneRaw, callData, outcome);

    // Idempotencia: call_ended + call_analyzed del mismo call_id no deben
    // reenviar WhatsApp ni re-enrollar.
    const meta = (lead.metadata as Record<string, unknown>) || {};
    if (
      callData.call_id &&
      meta.nurturing_handled_call_id === String(callData.call_id)
    ) {
      this.logger.log(
        `Follow-up ya aplicado para call_id=${callData.call_id} lead=${lead.id} — skip`,
      );
      return {
        outcome,
        phase: resolveCallPhase({
          agentId: callData.agent_id,
          templateKey: await this.resolveTemplateKey(callData),
          nurturingPhase: meta.last_phase
            ? String(meta.last_phase)
            : null,
          outboundAgentId: this.config.get<string>('RETELL_OUTBOUND_AGENT_ID'),
          followupAgentId: resolveRetellFollowupAgentId(
            this.config.get<string>('RETELL_AGENT_ID_FOLLOWUP'),
          ),
        }),
        whatsappSent: false,
        smsSent: false,
        enrolled: false,
        markedIlocalizable: false,
        leadId: lead.id,
      };
    }

    const templateKey = await this.resolveTemplateKey(callData);
    const nurturingPhase =
      callData.retell_llm_dynamic_variables?.nurturing_phase ||
      callData.collected_dynamic_variables?.nurturing_phase ||
      callData.call_analysis?.custom_analysis_data?.nurturing_phase;
    const phase = resolveCallPhase({
      agentId: callData.agent_id,
      templateKey,
      nurturingPhase: nurturingPhase ? String(nurturingPhase) : null,
      outboundAgentId: this.config.get<string>('RETELL_OUTBOUND_AGENT_ID'),
      followupAgentId: resolveRetellFollowupAgentId(
        this.config.get<string>('RETELL_AGENT_ID_FOLLOWUP'),
      ),
    });

    if (this.classifier.shouldMarkClosed(outcome)) {
      await this.leads.updateStatus(lead.id, {
        status: LeadStatus.CERRADO,
        reason: 'explicit_rejection',
      });
      if (callData.call_id) {
        await this.prisma.lead.update({
          where: { id: lead.id },
          data: {
            metadata: {
              ...((lead.metadata as object) || {}),
              last_call_id: callData.call_id,
              last_outcome: outcome,
              last_phase: phase,
              nurturing_handled_call_id: String(callData.call_id),
            },
          },
        });
      }
      this.logger.log(
        `Lead ${lead.id} cerrado por rechazo explícito (outcome=${outcome} phase=${phase})`,
      );
      return {
        outcome,
        phase,
        whatsappSent: false,
        smsSent: false,
        enrolled: false,
        markedIlocalizable: false,
        leadId: lead.id,
      };
    }

    if (outcome === CallOutcome.ANSWERED_SUCCESS) {
      await this.enrollments.stopActiveForLead(lead.id, 'answered_success');
      await this.prisma.lead.update({
        where: { id: lead.id },
        data: {
          metadata: {
            ...((lead.metadata as object) || {}),
            last_call_id: callData.call_id,
            last_outcome: outcome,
            last_phase: phase,
            ...(callData.call_id
              ? { nurturing_handled_call_id: String(callData.call_id) }
              : {}),
          },
        },
      });
      return {
        outcome,
        phase,
        whatsappSent: false,
        smsSent: false,
        enrolled: false,
        markedIlocalizable: false,
        leadId: lead.id,
      };
    }

    let whatsappSent = false;
    let smsSent = false;
    let enrolled = false;
    let markedIlocalizable = false;
    const t0Channel = resolveT0MessageChannel(
      this.config.get('NURTURING_T0_CHANNEL'),
    );
    const plan = planNoContactFollowup(phase, {
      t0Channel,
      // Solo no_answer / postpone (y busy/voicemail) enrollan en T+0
      enroll: enrollRetry && phase === 't0',
    });

    // T+7 SMS / T+10 ilocalizable solo si el outcome sigue siendo no-contacto enrollable
    if (phase === 't7' && enrollRetry) {
      plan.sendSms = true;
    }
    if (phase === 't10' && enrollRetry) {
      plan.markIlocalizable = true;
    }
    if (phase === 't7' && !enrollRetry) {
      plan.sendSms = false;
    }
    if (phase === 't10' && !enrollRetry) {
      plan.markIlocalizable = false;
    }

    if (phase === 't0') {
      this.logger.log(
        `[Followup] T+0 enroll=${plan.enroll} channel=${t0Channel} WA=${plan.sendWhatsApp} SMS=${plan.sendSms} (hangup→PENDIENTE sin cola)`,
      );
    }

    if (plan.sendWhatsApp || plan.sendSms) {
      const callVars = {
        ...(callData.retell_llm_dynamic_variables || {}),
        ...(callData.collected_dynamic_variables || {}),
        ...(callData.call_analysis?.custom_analysis_data || {}),
      } as Record<string, unknown>;
      const sent = await this.sendToniBookingMessages(lead, callData.call_id, {
        whatsapp: plan.sendWhatsApp,
        sms: plan.sendSms,
        /** Si WA falla o está deshabilitado, no perder el hilo: enviar SMS. */
        smsFallbackIfWhatsappFails: plan.sendWhatsApp && !plan.sendSms,
        waKey: TEMPLATE_WA_T0,
        smsKey:
          plan.sendSms && phase === 't0' ? TEMPLATE_SMS_T0 : TEMPLATE_SMS_T7,
        summaryPrefix: `${phase}_${outcome}`,
        callVars,
      });
      whatsappSent = sent.whatsappSent;
      smsSent = sent.smsSent;
    }

    if (markPendiente && !plan.markIlocalizable) {
      await this.leads.updateStatus(lead.id, {
        status: LeadStatus.PENDIENTE,
        reason: `${outcome}:${phase}`,
      });
      this.logger.log(
        `Lead ${lead.id} → PENDIENTE (outcome=${outcome} phase=${phase} enroll=${plan.enroll})`,
      );
    }

    if (plan.enroll) {
      try {
        await this.enrollments.enrollLead(lead.id);
        enrolled = true;
        this.logger.log(
          `Lead ${lead.id} enrollado en secuencia T+7/T+10 (outcome=${outcome})`,
        );
      } catch (err) {
        this.logger.warn(
          `Enroll after ${outcome} skipped: ${
            err instanceof Error ? err.message : err
          }`,
        );
      }
    } else if (phase === 't0' && markPendiente) {
      this.logger.log(
        `Lead ${lead.id} sin enroll T+7/T+10 (outcome=${outcome} — solo PENDIENTE)`,
      );
    }

    if (plan.markIlocalizable) {
      await this.leads.updateStatus(lead.id, {
        status: LeadStatus.ILOCALIZABLE,
        reason: 't10_no_contact',
      });
      markedIlocalizable = true;
      this.logger.log(
        `Lead ${lead.id} → ILOCALIZABLE tras T+10 sin contacto (outcome=${outcome})`,
      );
    }

    await this.prisma.lead.update({
      where: { id: lead.id },
      data: {
        metadata: {
          ...((lead.metadata as object) || {}),
          last_call_id: callData.call_id,
          last_outcome: outcome,
          last_phase: phase,
          ...(callData.call_id
            ? { nurturing_handled_call_id: String(callData.call_id) }
            : {}),
        },
      },
    });

    this.logger.log(
      `Follow-up lead=${lead.id} phase=${phase} outcome=${outcome} wa=${whatsappSent} sms=${smsSent} enroll=${enrolled} ilocalizable=${markedIlocalizable}`,
    );

    return {
      outcome,
      phase,
      whatsappSent,
      smsSent,
      enrolled,
      markedIlocalizable,
      leadId: lead.id,
    };
  }

  /**
   * Si el número no está en BD al finalizar la llamada, lo crea automáticamente.
   */
  private async findOrCreateLeadFromCall(
    phoneRaw: string,
    callData: Record<string, any>,
    outcome: CallOutcome,
  ) {
    const phone = normalizePhone(phoneRaw);
    const e164 = formatE164Spain(phoneRaw);
    const digits = phone.replace(/\D/g, '').slice(-9);

    let lead =
      (await this.prisma.lead.findUnique({ where: { phone } })) ||
      (phone !== e164
        ? await this.prisma.lead.findUnique({ where: { phone: e164 } })
        : null);

    if (!lead && digits.length >= 9) {
      lead = await this.prisma.lead.findFirst({
        where: { phone: { contains: digits } },
        orderBy: { updatedAt: 'desc' },
      });
    }

    if (!lead) {
      const storedPhone = e164 || phone;
      const callVars = {
        ...(callData.retell_llm_dynamic_variables || {}),
        ...(callData.collected_dynamic_variables || {}),
        ...(callData.call_analysis?.custom_analysis_data || {}),
      } as Record<string, unknown>;
      const nameFromCall =
        callData.call_analysis?.custom_analysis_data?.nombre_contacto ||
        resolveLeadContactName({ name: null, metadata: {} }, callVars) ||
        null;
      const propiedad = resolveLeadPropertyLabel(
        { name: null, metadata: {} },
        callVars,
      );
      lead = await this.prisma.lead.create({
        data: {
          phone: storedPhone,
          name: nameFromCall ? String(nameFromCall) : null,
          source: 'outbound',
          status: LeadStatus.NUEVO as any,
          externalRef: callData.call_id ? String(callData.call_id) : null,
          metadata: {
            last_call_id: callData.call_id,
            last_outcome: outcome,
            created_from: 'retell_webhook',
            ...(propiedad ? { propiedad } : {}),
            ...(callVars.municipio
              ? { municipio: String(callVars.municipio) }
              : {}),
            ...(callVars.tipo_inmueble
              ? { tipo_inmueble: String(callVars.tipo_inmueble) }
              : {}),
            ...(callVars.nombre_via
              ? { nombre_via: String(callVars.nombre_via) }
              : {}),
            ...(callVars.tipo_via
              ? { tipo_via: String(callVars.tipo_via) }
              : {}),
            ...(callVars['Direccion titulo anuncio']
              ? {
                  direccion_titulo_anuncio: String(
                    callVars['Direccion titulo anuncio'],
                  ),
                }
              : {}),
          },
        },
      });
      this.logger.log(
        `Lead creado automáticamente phone=${storedPhone} id=${lead.id} outcome=${outcome}`,
      );
    }

    return lead;
  }

  private async resolveTemplateKey(
    callData: Record<string, any>,
  ): Promise<string | null> {
    const fromVars =
      callData.retell_llm_dynamic_variables?.template_key ||
      callData.collected_dynamic_variables?.template_key ||
      callData.call_analysis?.custom_analysis_data?.template_key;
    if (fromVars) return String(fromVars);

    const callId = callData.call_id;
    if (!callId) return null;

    const stepRun = await this.prisma.sequenceStepRun.findFirst({
      where: { providerRef: String(callId) },
      include: { step: true },
    });
    if (stepRun?.step?.templateKey) return stepRun.step.templateKey;

    const log = await this.prisma.communicationLog.findFirst({
      where: { providerRef: String(callId) },
    });
    if (log?.stepRunId) {
      const viaLog = await this.prisma.sequenceStepRun.findUnique({
        where: { id: log.stepRunId },
        include: { step: true },
      });
      if (viaLog?.step?.templateKey) return viaLog.step.templateKey;
    }
    return null;
  }

  private async sendToniBookingMessages(
    lead: { id: string; phone: string; name: string | null; email: string | null; metadata?: unknown },
    callId: string | undefined,
    opts: {
      whatsapp: boolean;
      sms: boolean;
      /** Si true y WA no llega, dispara SMS con Content SID (evita fallo silencioso). */
      smsFallbackIfWhatsappFails?: boolean;
      waKey?: string;
      smsKey?: string;
      summaryPrefix: string;
      /** Variables Retell de la llamada (fallback si el lead aún no tiene metadata Sheets). */
      callVars?: Record<string, unknown> | null;
    },
  ): Promise<{ whatsappSent: boolean; smsSent: boolean }> {
    const bookingLink =
      this.config.get<string>('BOOKING_LINK_CALL') || TONI_BOOKING_LINK;
    // Content SID lo resuelve SmsChannel (default seguimiento_lead_fase3).
    // {{1}} nombre / {{2}} propiedad — siempre desde lead (+ callVars), nunca literales fijos.
    const contentVariables = buildSeguimientoSmsContentVariables(
      lead,
      opts.callVars,
    );
    this.logger.log(
      `[Followup] Content vars lead=${lead.id} {{1}}=${JSON.stringify(contentVariables['1'])} {{2}}=${JSON.stringify(contentVariables['2'])}`,
    );
    if (!contentVariables['1'] || !contentVariables['2']) {
      this.logger.warn(
        `[Followup] Content vars incompletas lead=${lead.id} name=${!!contentVariables['1']} propiedad=${!!contentVariables['2']} — se envía igual con lo disponible`,
      );
    }

    const payload: Record<string, unknown> = {
      body: TONI_NO_ANSWER_MESSAGE,
      booking_link: bookingLink,
      contentVariables,
    };
    const explicitSid =
      this.config.get<string>('TWILIO_SMS_CONTENT_SID') ??
      this.config.get<string>('TWILIO_CONTENT_SID_SEGUIMIENTO');
    if (explicitSid !== undefined && String(explicitSid).trim() !== '') {
      payload.contentSid = String(explicitSid).trim();
    } else if (explicitSid === undefined) {
      payload.contentSid = TWILIO_CONTENT_SID_SEGUIMIENTO_FASE3;
    }
    const stepRunId = `retell:${callId || 'unknown'}`;
    let whatsappSent = false;
    let smsSent = false;
    let whatsappFailed = false;

    if (opts.whatsapp) {
      if (!this.whatsapp.isEnabled()) {
        this.logger.warn(
          `[Followup] WhatsApp omitido (NURTURING_WHATSAPP_ENABLED≠true) lead=${lead.id} — usará SMS si aplica`,
        );
        whatsappFailed = true;
      } else {
        this.logger.log(
          `[Followup] Disparando WhatsApp lead=${lead.id} phone=${lead.phone} call=${callId}`,
        );
        const result = await this.whatsapp.send({
          leadId: lead.id,
          phone: lead.phone,
          name: lead.name,
          email: lead.email,
          templateKey: opts.waKey || TEMPLATE_WA_T0,
          templatePayload: payload,
          stepRunId,
        });
        whatsappSent = result.success;
        whatsappFailed = !result.success;
        if (!result.success) {
          this.logger.error(
            `[Followup] WhatsApp FALLÓ lead=${lead.id} phone=${lead.phone}: ${result.error}`,
          );
        }
        if (result.success) {
          await this.prisma.communicationLog.create({
            data: {
              leadId: lead.id,
              channel: PrismaChannel.whatsapp,
              direction: 'outbound',
              summary: `${opts.summaryPrefix}:whatsapp`,
              providerRef: result.providerRef,
            },
          });
        }
      }
    }

    const shouldSms =
      opts.sms ||
      (opts.smsFallbackIfWhatsappFails === true && whatsappFailed);

    if (shouldSms) {
      if (!opts.sms && whatsappFailed) {
        this.logger.log(
          `[Followup] Fallback SMS (Content SID) tras WA no disponible/fallido lead=${lead.id}`,
        );
      }
      const result = await this.sms.send({
        leadId: lead.id,
        phone: lead.phone,
        name: lead.name,
        email: lead.email,
        templateKey: opts.smsKey || TEMPLATE_SMS_T0,
        templatePayload: payload,
        stepRunId,
      });
      smsSent = result.success;
      if (!result.success) {
        this.logger.error(
          `[Followup] SMS FALLÓ lead=${lead.id} phone=${lead.phone}: ${result.error}`,
        );
      }
      if (result.success) {
        await this.prisma.communicationLog.create({
          data: {
            leadId: lead.id,
            channel: PrismaChannel.sms,
            direction: 'outbound',
            summary: `${opts.summaryPrefix}:sms`,
            providerRef: result.providerRef,
          },
        });
      }
    }

    return { whatsappSent, smsSent };
  }
}
