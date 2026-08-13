import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Channel as PrismaChannel } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { WhatsappChannel } from '../channels/whatsapp.channel';
import { normalizePhone } from '../utils/phone.util';
import { EnrollmentsService } from '../enrollments/enrollments.service';
import { LeadStatus } from '../enums';
import { CallOutcome } from '../enums/lead-status.enum';
import { CallOutcomeClassifier } from './call-outcome.classifier';

/**
 * Tras outbound Retell: si no contesta → WhatsApp con link Calendar.
 * NO marca cerrado. Auto-stop solo vía cita_programada / rechazo explícito.
 */
@Injectable()
export class NoAnswerFollowupService {
  private readonly logger = new Logger(NoAnswerFollowupService.name);

  constructor(
    private readonly classifier: CallOutcomeClassifier,
    private readonly whatsapp: WhatsappChannel,
    private readonly prisma: PrismaService,
    private readonly enrollments: EnrollmentsService,
    private readonly config: ConfigService,
  ) {}

  async handleOutboundCallAnalyzed(callData: Record<string, any>): Promise<{
    outcome: CallOutcome;
    whatsappSent: boolean;
    leadId?: string;
  }> {
    const outcome = this.classifier.classify(callData);
    const phoneRaw = callData.to_number || '';
    if (!phoneRaw) {
      this.logger.warn('No to_number on call — skip follow-up');
      return { outcome, whatsappSent: false };
    }

    const phone = normalizePhone(phoneRaw);
    let lead = await this.prisma.lead.findUnique({ where: { phone } });
    if (!lead) {
      lead = await this.prisma.lead.create({
        data: {
          phone,
          name: callData.call_analysis?.custom_analysis_data?.nombre_contacto || null,
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

    if (this.classifier.shouldMarkClosed(outcome)) {
      await this.prisma.lead.update({
        where: { id: lead.id },
        data: {
          status: LeadStatus.CERRADO as any,
          statusChangedAt: new Date(),
          metadata: {
            ...((lead.metadata as object) || {}),
            last_outcome: outcome,
            closed_reason: 'explicit_rejection',
          },
        },
      });
      await this.enrollments.stopActiveForLead(
        lead.id,
        'lead_status:cerrado:explicit_rejection',
      );
      this.logger.log(
        `Lead ${lead.id} cerrado por rechazo explícito (outcome=${outcome})`,
      );
      return { outcome, whatsappSent: false, leadId: lead.id };
    }

    let whatsappSent = false;
    if (this.classifier.shouldSendBookingWhatsApp(outcome)) {
      const bookingLink =
        this.config.get<string>('BOOKING_LINK') ||
        this.config.get<string>('CALENDAR_BOOKING_URL') ||
        'https://www.localicer.com/agendar';

      const result = await this.whatsapp.send({
        leadId: lead.id,
        phone: lead.phone,
        name: lead.name,
        email: lead.email,
        templateKey: 'nurturing.whatsapp.booking_link',
        templatePayload: {
          body:
            'Hola {{name}}, no hemos podido hablar por teléfono. ' +
            'Puedes agendar una visita aquí: {{booking_link}} — Localicer',
          booking_link: bookingLink,
        },
        stepRunId: `retell:${callData.call_id || 'unknown'}`,
      });

      whatsappSent = result.success;
      if (result.success) {
        await this.prisma.communicationLog.create({
          data: {
            leadId: lead.id,
            channel: PrismaChannel.whatsapp,
            direction: 'outbound',
            summary: `no_answer_followup:${outcome}`,
            providerRef: result.providerRef,
          },
        });
      }

      // Asegura secuencia de seguimiento (día 7) sin email intermedio
      try {
        await this.enrollments.enrollLead(lead.id);
      } catch (err) {
        this.logger.warn(
          `Enroll after no-answer skipped: ${
            err instanceof Error ? err.message : err
          }`,
        );
      }

      this.logger.log(
        `No-answer follow-up lead=${lead.id} outcome=${outcome} wa=${whatsappSent}`,
      );
    }

    await this.prisma.lead.update({
      where: { id: lead.id },
      data: {
        metadata: {
          ...((lead.metadata as object) || {}),
          last_call_id: callData.call_id,
          last_outcome: outcome,
        },
      },
    });

    return { outcome, whatsappSent, leadId: lead.id };
  }
}
