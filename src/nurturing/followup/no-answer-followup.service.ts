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
  TEMPLATE_CALL_FOLLOWUP_D10,
  TEMPLATE_SMS_T0,
  TEMPLATE_SMS_T7,
  TEMPLATE_WA_T0,
  TONI_BOOKING_LINK,
  TWILIO_CONTENT_SID_SEGUIMIENTO_FASE3,
  renderToniNoAnswerFallback,
  resolveCallPhase,
  resolveRetellFollowupAgentId,
  type NurturingCallPhase,
} from '../toni-fase3.constants';
import {
  NURTURING_PHASE3_DISABLED_LOG,
  isNurturingPhase3Enabled,
} from '../phase3-enabled';
import { isNurturingFastTest } from '../nurturing-fast-delay';
import {
  PHASE3_LEAD_NOT_ALLOWED_LOG,
  PHASE3_TONI_PHONE_E164,
  isPhase3AllowedPhone,
} from '../phase3-allowlist';
import { normalizePhone, formatE164Spain } from '../utils/phone.util';
import {
  OUTBOUND_SANDBOX_WHITELIST_E164,
  isAllowedOutboundSandboxPhone,
  isOutboundSandboxWhitelistEnabled,
} from '../../outbound/outbound-sandbox-whitelist';
import { CallOutcomeClassifier } from './call-outcome.classifier';
import {
  planToniSequence,
} from './no-answer-followup.policy';
import {
  buildSeguimientoSmsContentVariables,
  resolveLeadContactName,
  resolveLeadPropertyLabel,
} from './lead-sms-content-vars';
import { resolveRetellLeadPhone } from './retell-call-phone';

/**
 * Retell outbound / follow-up (Fase 3):
 * - Llamada 1, no contesta o cuelga: WhatsApp con enlace (SMS si WA está off) y encola llamada 2.
 * - Llamada 2, no contesta o contesta y cuelga: SMS de respaldo y encola llamada 3.
 * - Llamada 3, no contesta: ILOCALIZABLE y fin de secuencia.
 * - Contesta con éxito o rechazo explícito: se detiene, sin siguiente reintento.
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
      `[FASE3][RESULTADO] call=${callData.call_id || '?'} outcome=${outcome} enrollRetry=${enrollRetry} pendiente=${markPendiente} reason=${callData.disconnection_reason || callData.call_status || '?'}`,
    );
    const phoneRaw =
      resolveRetellLeadPhone(callData) || callData.to_number || '';
    if (!phoneRaw) {
      this.logger.warn(
        '[Followup] No teléfono lead (to_number/from_number) — skip follow-up',
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

    // Fase 3 solo Toni (allowlist). Resto → solo Fase 1, sin SMS/enroll/cola.
    if (
      !isPhase3AllowedPhone(
        phoneRaw,
        this.config.get('NURTURING_PHASE3_PHONE_ALLOWLIST'),
      )
    ) {
      this.logger.log(
        `${PHASE3_LEAD_NOT_ALLOWED_LOG} to=${phoneRaw} call=${callData.call_id} (allow=${PHASE3_TONI_PHONE_E164})`,
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

    // Sandbox Retell (si activo): refuerzo adicional
    if (
      isOutboundSandboxWhitelistEnabled(
        this.config.get('OUTBOUND_SANDBOX_WHITELIST_ENABLED'),
      ) &&
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
    const followupAgentId = resolveRetellFollowupAgentId(
      this.config.get<string>('RETELL_AGENT_ID_FOLLOWUP'),
    );
    let phase = resolveCallPhase({
      agentId: callData.agent_id,
      templateKey,
      nurturingPhase: nurturingPhase ? String(nurturingPhase) : null,
      outboundAgentId: this.config.get<string>('RETELL_OUTBOUND_AGENT_ID'),
      followupAgentId,
    });

    // Follow-up agent sin template en webhook: inferir T+7/T+10 desde historial.
    if (phase === 'unknown' && callData.agent_id === followupAgentId) {
      phase = this.inferFollowupPhaseFromLead(meta);
      this.logger.log(
        `[Followup] phase inferida desde lead metadata → ${phase} (followup agent sin template)`,
      );
    }

    /**
     * Enroll T+7/T+10 solo en T+0. Si Retell manda un agent_id que no matchea
     * RETELL_OUTBOUND_AGENT_ID (prueba manual / typo), phase queda `unknown` y
     * antes se perdía el enroll pese a no_answer. Con outcome enrollable y sin
     * template T+7/T+10, tratamos unknown como t0 — NUNCA si ya es follow-up.
     */
    const continuesSequence =
      enrollRetry || outcome === CallOutcome.HANGUP;
    const effectivePhase: NurturingCallPhase =
      phase === 'unknown' &&
      continuesSequence &&
      callData.agent_id !== followupAgentId
        ? 't0'
        : phase;
    if (phase !== effectivePhase) {
      this.logger.warn(
        `[Followup] phase=${phase}→${effectivePhase} (enrollRetry + agent/template no resuelto). ` +
          `agent=${callData.agent_id} outboundEnv=${this.config.get('RETELL_OUTBOUND_AGENT_ID')}`,
      );
    }

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
              last_phase: effectivePhase,
              nurturing_handled_call_id: String(callData.call_id),
            },
          },
        });
      }
      this.logger.log(
        `Lead ${lead.id} cerrado por rechazo explícito (outcome=${outcome} phase=${effectivePhase})`,
      );
      return {
        outcome,
        phase: effectivePhase,
        whatsappSent: false,
        smsSent: false,
        enrolled: false,
        markedIlocalizable: false,
        leadId: lead.id,
      };
    }

    if (outcome === CallOutcome.ANSWERED_SUCCESS) {
      this.logger.log(
        `[FASE3][RESULTADO] call=${callData.call_id || '?'} phase=${effectivePhase} outcome=answered_success — secuencia detenida, sin SMS ni siguiente reintento`,
      );
      await this.enrollments.stopActiveForLead(lead.id, 'answered_success');
      await this.prisma.lead.update({
        where: { id: lead.id },
        data: {
          metadata: {
            ...((lead.metadata as object) || {}),
            last_call_id: callData.call_id,
            last_outcome: outcome,
            last_phase: effectivePhase,
            ...(callData.call_id
              ? { nurturing_handled_call_id: String(callData.call_id) }
              : {}),
          },
        },
      });
      return {
        outcome,
        phase: effectivePhase,
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
    const plan = planToniSequence(effectivePhase, outcome);

    this.logger.log(
      `[FASE3][PLAN] phase=${effectivePhase} outcome=${outcome} ` +
        `wa=${plan.sendWhatsApp} sms=${plan.sendSms} enroll=${plan.enroll} ` +
        `scheduleNext=${plan.scheduleNextCall} ilocalizable=${plan.markIlocalizable} ` +
        `endSequence=${plan.endSequence}`,
    );

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
          plan.sendSms && effectivePhase === 't0'
            ? TEMPLATE_SMS_T0
            : TEMPLATE_SMS_T7,
        summaryPrefix: `${effectivePhase}_${outcome}`,
        callVars,
      });
      whatsappSent = sent.whatsappSent;
      smsSent = sent.smsSent;
    }

    if (markPendiente && !plan.markIlocalizable) {
      await this.leads.updateStatus(lead.id, {
        status: LeadStatus.PENDIENTE,
        reason: `${outcome}:${effectivePhase}`,
      });
      this.logger.log(
        `[FASE3][ESTADO] lead=${lead.id} → PENDIENTE (outcome=${outcome} phase=${effectivePhase} enroll=${plan.enroll})`,
      );
    }

    if (plan.enroll) {
      try {
        if (isNurturingFastTest(this.config.get('NURTURING_FAST_TEST'))) {
          const restarted = await this.enrollments.stopActiveForLead(
            lead.id,
            'fast_test_restart',
          );
          if (restarted > 0) {
            this.logger.warn(
              `[FASE3][BULLMQ] prueba rápida: enrollment anterior cancelado (${restarted}) para empezar el ciclo desde la llamada 1`,
            );
          }
        }
        const enrolledResult = await this.enrollments.enrollLead(lead.id);
        enrolled = true;
        this.logger.log(
          `[FASE3][BULLMQ] lead=${lead.id} enrollado enrollment=${enrolledResult.enrollmentId} pasos=${enrolledResult.stepsScheduled} outcome=${outcome} phase=${effectivePhase}`,
        );
      } catch (err) {
        this.logger.error(
          `[FASE3][BULLMQ] enroll FALLÓ lead=${lead.id} outcome=${outcome}: ${
            err instanceof Error ? err.message : err
          }`,
        );
      }
    } else if (effectivePhase === 't0' && markPendiente) {
      this.logger.log(
        `[FASE3][PLAN] lead=${lead.id} sin enroll (outcome=${outcome} — solo PENDIENTE)`,
      );
    }

    if (plan.scheduleNextCall) {
      try {
        const queued = await this.enrollments.scheduleNextFollowup(
          lead.id,
          TEMPLATE_CALL_FOLLOWUP_D10,
        );
        this.logger.log(
          `[FASE3][BULLMQ] llamada 3 tras llamada 2 status=${queued.status} ` +
            `scheduledFor=${queued.scheduledFor ?? 'n/a'} madrid=${queued.scheduledForMadrid ?? 'n/a'} ` +
            `delayMin=${queued.delayMinutes ?? 'n/a'} jobId=${queued.jobId ?? 'n/a'} stepRun=${queued.stepRunId ?? 'n/a'} lead=${lead.id}`,
        );
      } catch (err) {
        this.logger.error(
          `[FASE3][BULLMQ] no se pudo encolar la llamada 3 lead=${lead.id}: ${
            err instanceof Error ? err.message : err
          }`,
        );
      }
    }

    if (plan.markIlocalizable) {
      const statusResult = await this.leads.updateStatus(lead.id, {
        status: LeadStatus.ILOCALIZABLE,
        reason: 't10_no_contact',
      });
      markedIlocalizable = true;
      this.logger.log(
        `[FASE3][ESTADO] lead=${lead.id} → ILOCALIZABLE (llamada 3 sin contacto, outcome=${outcome}). Secuencia terminada, enrollments detenidos=${statusResult.sequencesStopped}.`,
      );
    }

    await this.prisma.lead.update({
      where: { id: lead.id },
      data: {
        metadata: {
          ...((lead.metadata as object) || {}),
          last_call_id: callData.call_id,
          last_outcome: outcome,
          last_phase: effectivePhase,
          last_phase_raw: phase,
          last_enroll_attempted: plan.enroll,
          last_enrolled: enrolled,
          last_sms_sent: smsSent,
          ...(callData.call_id
            ? { nurturing_handled_call_id: String(callData.call_id) }
            : {}),
        },
      },
    });

    this.logger.log(
      `[FASE3][HECHO] lead=${lead.id} phase=${effectivePhase} outcome=${outcome} wa=${whatsappSent} sms=${smsSent} enroll=${enrolled} ilocalizable=${markedIlocalizable} call=${callData.call_id || '?'}`,
    );

    return {
      outcome,
      phase: effectivePhase,
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

  /**
   * Si el agente follow-up no trae template_key, usa la última fase del lead:
   * t0 → esta es T+7; t7 → esta es T+10; t10 → permanece t10.
   */
  private inferFollowupPhaseFromLead(
    meta: Record<string, unknown>,
  ): NurturingCallPhase {
    const last = String(meta.last_phase || '')
      .toLowerCase()
      .trim();
    if (last === 't0' || last === 'unknown' || !last) return 't7';
    if (last === 't7') return 't10';
    if (last === 't10') return 't10';
    return 't7';
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
    // Content SID: plantilla Twilio ({{1}} = título inmueble; enlace embebido).
    const contentVariables = buildSeguimientoSmsContentVariables(
      lead,
      opts.callVars,
    );
    this.logger.log(
      `[Followup] Content vars lead=${lead.id} {{1}} título=${JSON.stringify(contentVariables['1'])}`,
    );
    if (!contentVariables['1']) {
      this.logger.warn(
        `[Followup] Content vars incompletas lead=${lead.id} título vacío — se envía igual con fallback`,
      );
    }

    const payload: Record<string, unknown> = {
      body: renderToniNoAnswerFallback(contentVariables, lead.name),
      booking_link: bookingLink,
      contentVariables,
      /** La llamada 1 de la secuencia siempre intenta WhatsApp, aunque el flag esté en false. */
      bypassWhatsappGate: true,
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
      this.logger.log(
        `[FASE3][MENSAJE] enviando WhatsApp con enlace de cita lead=${lead.id} phone=${lead.phone} call=${callId}`,
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
          this.logger.log(
            `[FASE3][MENSAJE] WhatsApp enviado lead=${lead.id} phone=${lead.phone} sid=${result.providerRef || '?'} call=${callId || '?'}`,
          );
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
        this.logger.log(
          `[FASE3][MENSAJE] SMS enviado lead=${lead.id} phone=${lead.phone} sid=${result.providerRef || '?'} template=${opts.smsKey || TEMPLATE_SMS_T0} call=${callId || '?'}`,
        );
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
