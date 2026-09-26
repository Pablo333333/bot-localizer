import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Retell from 'retell-sdk';
import { INBOUND_SPANISH_SUMMARY_PROMPT } from './inbound-summary-language';

/**
 * Deja el agente inbound con el mismo criterio que el outbound:
 * el resumen post-llamada se genera en español.
 * Solo publica si el prompt aún no era el español, para no re-publicar en cada arranque.
 */
@Injectable()
export class InboundSummaryLanguageService implements OnModuleInit {
  private readonly logger = new Logger(InboundSummaryLanguageService.name);

  constructor(private readonly config: ConfigService) {}

  async onModuleInit(): Promise<void> {
    const apiKey = this.config.get<string>('RETELL_API_KEY')?.trim();
    const agentId = this.config.get<string>('RETELL_INBOUND_AGENT_ID')?.trim();
    if (!apiKey || !agentId || /x{4,}/i.test(agentId)) {
      this.logger.warn(
        '[Retell inbound] Sin RETELL_API_KEY o RETELL_INBOUND_AGENT_ID real — el resumen en español queda solo en la respuesta call_inbound.',
      );
      return;
    }

    const retell = new Retell({ apiKey });
    try {
      const current = await retell.agent.retrieve(agentId);
      if (current.analysis_summary_prompt === INBOUND_SPANISH_SUMMARY_PROMPT) {
        if (current.is_published) {
          this.logger.log(
            `[Retell inbound] agent=${agentId} ya tiene call_summary en español en la versión publicada.`,
          );
          return;
        }
        await retell.agent.publish(agentId);
        this.logger.log(
          `[Retell inbound] agent=${agentId} publicado con el resumen en español.`,
        );
        return;
      }

      await retell.agent.update(agentId, {
        analysis_summary_prompt: INBOUND_SPANISH_SUMMARY_PROMPT,
      });
      await retell.agent.publish(agentId);
      this.logger.log(
        `[Retell inbound] agent=${agentId} actualizado y publicado: call_summary siempre en español.`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `[Retell inbound] No se pudo fijar el resumen en español de ${agentId}: ${message}. ` +
          'La respuesta call_inbound sigue enviando el override por llamada.',
      );
    }
  }
}
