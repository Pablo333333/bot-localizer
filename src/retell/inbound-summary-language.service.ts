import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  INBOUND_SPANISH_SUMMARY_PROMPT,
  retellRequest,
} from './inbound-summary-language';

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

    try {
      await this.ensureSpanishSummary(apiKey, agentId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `[Retell inbound] No se pudo fijar el resumen en español de ${agentId}: ${message}. ` +
          'La respuesta call_inbound sigue enviando el override por llamada.',
      );
    }
  }

  private async ensureSpanishSummary(
    apiKey: string,
    agentId: string,
  ): Promise<void> {
    const current = await this.readAgent(apiKey, agentId);
    const prompt = String(current?.analysis_summary_prompt ?? '');
    const published = current?.is_published === true;

    if (prompt === INBOUND_SPANISH_SUMMARY_PROMPT && published) {
      this.logger.log(
        `[Retell inbound] agent=${agentId} ya tiene call_summary en español en la versión publicada.`,
      );
      return;
    }

    if (prompt !== INBOUND_SPANISH_SUMMARY_PROMPT) {
      await retellRequest({
        fetchImpl: fetch,
        apiKey,
        method: 'PATCH',
        path: `/update-agent/${encodeURIComponent(agentId)}`,
        jsonBody: { analysis_summary_prompt: INBOUND_SPANISH_SUMMARY_PROMPT },
        requireJsonBody: false,
      });
      const confirmed = await this.readAgent(apiKey, agentId);
      if (
        String(confirmed?.analysis_summary_prompt ?? '') !==
        INBOUND_SPANISH_SUMMARY_PROMPT
      ) {
        throw new Error(
          'Retell aceptó el update pero el agente sigue sin el prompt en español',
        );
      }
    }

    await retellRequest({
      fetchImpl: fetch,
      apiKey,
      method: 'POST',
      path: `/publish-agent/${encodeURIComponent(agentId)}`,
      requireJsonBody: false,
    });
    this.logger.log(
      `[Retell inbound] agent=${agentId} actualizado y publicado: call_summary siempre en español.`,
    );
  }

  private async readAgent(
    apiKey: string,
    agentId: string,
  ): Promise<Record<string, unknown> | null> {
    return retellRequest({
      fetchImpl: fetch,
      apiKey,
      method: 'GET',
      path: `/get-agent/${encodeURIComponent(agentId)}`,
      requireJsonBody: true,
    });
  }
}
