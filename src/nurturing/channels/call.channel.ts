import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Retell from 'retell-sdk';
import { Channel } from '../enums';
import { formatE164Spain } from '../utils/phone.util';
import {
  ChannelSendPayload,
  ChannelSendResult,
  NurturingChannel,
} from './channel.interface';

/**
 * Dispara llamada de seguimiento vía Retell (mismo patrón que outbound frío).
 * Vars: RETELL_API_KEY, RETELL_FROM_NUMBER, RETELL_OUTBOUND_AGENT_ID
 * Opcional: RETELL_NURTURING_AGENT_ID (override)
 */
@Injectable()
export class CallChannel implements NurturingChannel {
  readonly channel = Channel.LLAMADA;
  private readonly logger = new Logger(CallChannel.name);
  private readonly retell: Retell | null;
  private readonly fromNumber: string | undefined;
  private readonly agentId: string | undefined;

  constructor(private readonly config: ConfigService) {
    const apiKey = this.config.get<string>('RETELL_API_KEY');
    this.fromNumber = this.config.get<string>('RETELL_FROM_NUMBER');
    this.agentId =
      this.config.get<string>('RETELL_NURTURING_AGENT_ID') ||
      this.config.get<string>('RETELL_OUTBOUND_AGENT_ID');
    this.retell = apiKey ? new Retell({ apiKey }) : null;
  }

  async send(payload: ChannelSendPayload): Promise<ChannelSendResult> {
    const forceMock =
      this.config.get<string>('NURTURING_MOCK_CHANNELS') === 'true';

    if (forceMock || !this.retell || !this.fromNumber || !this.agentId) {
      const toNumber = formatE164Spain(payload.phone);
      const mockId = `mock_call_${Date.now()}`;
      this.logger.warn(
        `[MOCK Call/Retell] ${forceMock ? 'NURTURING_MOCK_CHANNELS=true' : 'Retell no configurado'} — simulado OK\n` +
          `  to: ${toNumber}\n` +
          `  leadId: ${payload.leadId}\n` +
          `  stepRunId: ${payload.stepRunId}\n` +
          `  providerRef: ${mockId}`,
      );
      return { success: true, providerRef: mockId };
    }

    try {
      const toNumber = formatE164Spain(payload.phone);
      const dynamicVars: Record<string, string> = {
        nombre: payload.name || '',
        lead_id: payload.leadId,
        step_run_id: payload.stepRunId,
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

      const call = await this.retell.call.createPhoneCall({
        from_number: this.fromNumber,
        to_number: toNumber,
        override_agent_id: this.agentId,
        retell_llm_dynamic_variables: dynamicVars,
      });

      this.logger.log(
        `Retell call started lead=${payload.leadId} call_id=${call.call_id} to=${toNumber}`,
      );
      return { success: true, providerRef: call.call_id };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Retell call failed lead=${payload.leadId}: ${message}`);
      return { success: false, error: message };
    }
  }
}
