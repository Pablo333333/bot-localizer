import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Retell from 'retell-sdk';
import { InboundService } from '../v2/inbound.service';

/**
 * Motor de respuesta para DMs de X:
 * 1) Preferido: Retell Chat Agent (X_AGENT_ID) — prompt de texto independiente de voz.
 * 2) Fallback: InboundService Localisto (OpenAI), si no hay agente Retell.
 */
@Injectable()
export class XChatService {
  private readonly logger = new Logger(XChatService.name);
  private readonly retell: Retell | null;
  /** senderId → Retell chat_id (sesión por conversación DM). */
  private readonly chatSessions = new Map<string, string>();

  constructor(
    private readonly config: ConfigService,
    private readonly inbound: InboundService,
  ) {
    const apiKey = this.config.get<string>('RETELL_API_KEY');
    this.retell = apiKey ? new Retell({ apiKey }) : null;
  }

  getAgentId(): string | undefined {
    const id = this.config.get<string>('X_AGENT_ID')?.trim();
    return id || undefined;
  }

  async generateReply(senderId: string, text: string): Promise<string> {
    const agentId = this.getAgentId();
    if (agentId && this.retell) {
      try {
        return await this.replyWithRetell(agentId, senderId, text);
      } catch (err) {
        this.logger.error(
          `Retell chat falló (X_AGENT_ID=${agentId}): ${err instanceof Error ? err.message : err} — fallback InboundService`,
        );
      }
    } else if (agentId && !this.retell) {
      this.logger.warn(
        'X_AGENT_ID definido pero falta RETELL_API_KEY — usando InboundService',
      );
    }

    return this.inbound.handleIncomingMessage(`x:dm:${senderId}`, text);
  }

  private async replyWithRetell(
    agentId: string,
    senderId: string,
    text: string,
  ): Promise<string> {
    let chatId = this.chatSessions.get(senderId);
    if (!chatId) {
      const chat = await this.retell!.chat.create({
        agent_id: agentId,
        metadata: { channel: 'x_dm', sender_id: senderId },
        retell_llm_dynamic_variables: {
          channel: 'x_dm',
          sender_id: senderId,
        },
      });
      chatId = chat.chat_id;
      this.chatSessions.set(senderId, chatId);
      this.logger.log(
        `Retell chat creado chat_id=${chatId} agent=${agentId} sender=${senderId}`,
      );
    }

    const completion = await this.retell!.chat.createChatCompletion({
      chat_id: chatId,
      content: text,
    });

    const reply = (completion.messages || [])
      .filter((m) => m.role === 'agent' && 'content' in m)
      .map((m) => {
        const content = (m as { content?: unknown }).content;
        return typeof content === 'string' ? content : '';
      })
      .filter((text) => text.trim().length > 0)
      .join('\n')
      .trim();

    if (!reply) {
      throw new Error('Retell chat completion sin mensaje de agente');
    }
    return reply;
  }

  /** Útil en tests / reset de sesión. */
  clearSession(senderId: string): void {
    this.chatSessions.delete(senderId);
  }
}
