import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Retell from 'retell-sdk';
import {
  OUTBOUND_AUTO_DIAL_PAUSED,
  OUTBOUND_AUTO_DIAL_PAUSED_LOG,
} from '../../outbound/outbound-enabled';
import {
  OUTBOUND_SANDBOX_WHITELIST_E164,
  SKIPPED_SANDBOX_WHITELIST,
  isAllowedOutboundSandboxPhone,
  safeCreatePhoneCall,
} from '../../outbound/outbound-sandbox-whitelist';
import { Channel } from '../enums';
import {
  TEMPLATE_CALL_FOLLOWUP_D10,
  TEMPLATE_CALL_FOLLOWUP_D7,
  isFollowupCallTemplate,
  resolveRetellFollowupAgentId,
  resolveRetellFromNumber,
} from '../toni-fase3.constants';
import { formatE164Spain } from '../utils/phone.util';
import {
  ChannelSendPayload,
  ChannelSendResult,
  NurturingChannel,
} from './channel.interface';

/**
 * Re-llamadas T+7 / T+10: RETELL_AGENT_ID_FOLLOWUP + from +34 871 075 112.
 */
@Injectable()
export class CallChannel implements NurturingChannel {
  readonly channel = Channel.LLAMADA;
  private readonly logger = new Logger(CallChannel.name);
  private readonly retell: Retell | null;
  private readonly fromNumber: string;
  private readonly outboundAgentId: string | undefined;
  private readonly followupAgentId: string;

  constructor(private readonly config: ConfigService) {
    const apiKey = this.config.get<string>('RETELL_API_KEY');
    this.fromNumber = resolveRetellFromNumber(
      this.config.get<string>('RETELL_FROM_NUMBER'),
    );
    this.outboundAgentId =
      this.config.get<string>('RETELL_NURTURING_AGENT_ID') ||
      this.config.get<string>('RETELL_OUTBOUND_AGENT_ID');
    this.followupAgentId = resolveRetellFollowupAgentId(
      this.config.get<string>('RETELL_AGENT_ID_FOLLOWUP') ||
        this.config.get<string>('RETELL_NURTURING_AGENT_ID'),
    );
    this.retell = apiKey ? new Retell({ apiKey }) : null;
  }

  private resolveAgentId(templateKey: string): string | undefined {
    if (isFollowupCallTemplate(templateKey)) {
      return this.followupAgentId;
    }
    return this.outboundAgentId;
  }

  async send(payload: ChannelSendPayload): Promise<ChannelSendResult> {
    let toNumber = '';
    try {
      toNumber = formatE164Spain(payload.phone);
    } catch {
      this.logger.warn(
        `[CallChannel] ${SKIPPED_SANDBOX_WHITELIST} lead=${payload.leadId} phone vacío o inválido`,
      );
      return { success: true, providerRef: SKIPPED_SANDBOX_WHITELIST };
    }

    if (!isAllowedOutboundSandboxPhone(toNumber)) {
      this.logger.warn(
        `[CallChannel] ${SKIPPED_SANDBOX_WHITELIST} lead=${payload.leadId} to=${toNumber} — sandbox solo ${OUTBOUND_SANDBOX_WHITELIST_E164}`,
      );
      return { success: true, providerRef: SKIPPED_SANDBOX_WHITELIST };
    }

    if (OUTBOUND_AUTO_DIAL_PAUSED) {
      this.logger.warn(
        `${OUTBOUND_AUTO_DIAL_PAUSED_LOG} lead=${payload.leadId} template=${payload.templateKey}`,
      );
      return { success: true, providerRef: 'paused_no_call' };
    }

    const forceMock =
      this.config.get<string>('NURTURING_MOCK_CHANNELS') === 'true';
    const agentId = this.resolveAgentId(payload.templateKey);

    if (forceMock || !this.retell || !this.fromNumber || !agentId) {
      const mockId = `mock_call_${Date.now()}`;
      this.logger.warn(
        `[MOCK Call/Retell] ${forceMock ? 'NURTURING_MOCK_CHANNELS=true' : 'Retell no configurado'} — simulado OK\n` +
          `  to: ${toNumber}\n` +
          `  agent: ${agentId || 'n/a'}\n` +
          `  from: ${this.fromNumber}\n` +
          `  template: ${payload.templateKey}\n` +
          `  leadId: ${payload.leadId}\n` +
          `  stepRunId: ${payload.stepRunId}\n` +
          `  providerRef: ${mockId}`,
      );
      return { success: true, providerRef: mockId };
    }

    try {
      const nurturingPhase =
        payload.templateKey === TEMPLATE_CALL_FOLLOWUP_D10
          ? 't10'
          : payload.templateKey === TEMPLATE_CALL_FOLLOWUP_D7
            ? 't7'
            : 't0';

      const dynamicVars: Record<string, string> = {
        nombre: payload.name || '',
        lead_id: payload.leadId,
        step_run_id: payload.stepRunId,
        template_key: payload.templateKey,
        nurturing_phase: nurturingPhase,
        summary:
          (payload.templatePayload?.summary as string | undefined) ||
          'Llamada de seguimiento nurturing',
      };

      const extra = payload.templatePayload?.retellVariables;
      if (extra && typeof extra === 'object') {
        for (const [k, v] of Object.entries(extra as Record<string, unknown>)) {
          if (v != null) dynamicVars[k] = String(v);
        }
      }
      // No permitir que extras borren la fase/template canónicos del step.
      dynamicVars.template_key = payload.templateKey;
      dynamicVars.nurturing_phase = nurturingPhase;

      const guarded = await safeCreatePhoneCall(
        this.retell,
        {
          from_number: this.fromNumber,
          to_number: toNumber,
          override_agent_id: agentId,
          retell_llm_dynamic_variables: dynamicVars,
        },
        (msg) => this.logger.warn(msg),
      );

      if (guarded.skipped) {
        return { success: true, providerRef: guarded.skipCode };
      }

      this.logger.log(
        `Retell call started lead=${payload.leadId} call_id=${guarded.call.call_id} agent=${agentId} from=${this.fromNumber} to=${toNumber}`,
      );
      return { success: true, providerRef: guarded.call.call_id };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Retell call failed lead=${payload.leadId}: ${message}`);
      return { success: false, error: message };
    }
  }
}
