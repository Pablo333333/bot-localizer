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
  resolveCallPhase,
  resolveRetellFollowupAgentId,
  type NurturingCallPhase,
} from '../toni-fase3.constants';
import {
  NURTURING_PHASE3_DISABLED_LOG,
  isNurturingPhase3Enabled,
} from '../phase3-enabled';
import { normalizePhone } from '../utils/phone.util';
import { CallOutcomeClassifier } from './call-outcome.classifier';
import { planNoContactFollowup } from './no-answer-followup.policy';

/**
 * T+0: NO_ANSWER/HANGUP → solo WhatsApp (plantilla Localisto + enlace cita) + enroll T+7/T+10.
 *       El SMS de seguimiento NO se envía en este primer intento.
 * T+7: no-contesta / fallo de la rellamada → SMS con enlace para reservar la cita.
 * T+10: no-contesta → estado ILOCALIZABLE (Prisma + Sheets).
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

  async handleOutboundCallAnalyzed(callData: Record<string, any>): Promise<{
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

    const outcome = this.classifier.classify(callData);
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

    const phone = normalizePhone(phoneRaw);
    let lead = await this.prisma.lead.findUnique({ where: { phone } });
    if (!lead) {
      lead = await this.prisma.lead.create({
        data: {
          phone,
          name:
            callData.call_analysis?.custom_analysis_data?.nombre_contacto ||
            null,
          source: 'outbound',
          status: LeadStatus.NUEVO as any,
          externalRef: callData.call_id,
          metadata: {
            last_call_id: callData.call_id,
            last_outcome: outcome,
          },
        },
      });
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

    const noContact = this.classifier.shouldSendBookingWhatsApp(outcome);
    let whatsappSent = false;
    let smsSent = false;
    let enrolled = false;
    let markedIlocalizable = false;
    const plan = noContact
      ? planNoContactFollowup(phase)
      : planNoContactFollowup('unknown');

    if (plan.sendWhatsApp || plan.sendSms) {
      const sent = await this.sendToniBookingMessages(lead, callData.call_id, {
        whatsapp: plan.sendWhatsApp,
        sms: plan.sendSms,
        waKey: TEMPLATE_WA_T0,
        smsKey: TEMPLATE_SMS_T7,
        summaryPrefix: `${phase}_no_answer:${outcome}`,
      });
      whatsappSent = sent.whatsappSent;
      smsSent = sent.smsSent;
    }

    if (plan.enroll) {
      try {
        await this.enrollments.enrollLead(lead.id);
        enrolled = true;
      } catch (err) {
        this.logger.warn(
          `Enroll after T+0 no-answer skipped: ${
            err instanceof Error ? err.message : err
          }`,
        );
      }
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
    lead: { id: string; phone: string; name: string | null; email: string | null },
    callId: string | undefined,
    opts: {
      whatsapp: boolean;
      sms: boolean;
      waKey?: string;
      smsKey?: string;
      summaryPrefix: string;
    },
  ): Promise<{ whatsappSent: boolean; smsSent: boolean }> {
    const bookingLink =
      this.config.get<string>('BOOKING_LINK_CALL') || TONI_BOOKING_LINK;
    const payload = {
      body: TONI_NO_ANSWER_MESSAGE,
      booking_link: bookingLink,
    };
    const stepRunId = `retell:${callId || 'unknown'}`;
    let whatsappSent = false;
    let smsSent = false;

    if (opts.whatsapp) {
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

    if (opts.sms) {
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
