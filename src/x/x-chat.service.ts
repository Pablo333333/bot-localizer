import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import Retell from 'retell-sdk';
import { loadLocalistoXDmSystemPrompt } from './x-dm-prompt';

/**
 * Motor de respuesta para DMs de X:
 * 1) Retell si X_AGENT_ID + RETELL_API_KEY
 * 2) OpenAI + prompt provisional (X_DM_SYSTEM_PROMPT o fallback genérico)
 *    — sin archivo .txt; Toni editará luego vía Sheets/DB.
 */
@Injectable()
export class XChatService {
  private readonly logger = new Logger(XChatService.name);
  private readonly retell: Retell | null;
  private readonly openai: OpenAI | null;
  private readonly retellSessions = new Map<string, string>();
  private readonly openAiHistory = new Map<
    string,
    Array<{ role: 'user' | 'assistant'; content: string }>
  >();

  constructor(private readonly config: ConfigService) {
    const retellKey = this.config.get<string>('RETELL_API_KEY');
    this.retell = retellKey ? new Retell({ apiKey: retellKey }) : null;
    const openaiKey = this.config.get<string>('OPENAI_API_KEY');
    this.openai = openaiKey ? new OpenAI({ apiKey: openaiKey }) : null;
  }

  getAgentId(): string | undefined {
    const id = this.config.get<string>('X_AGENT_ID')?.trim();
    return id || undefined;
  }

  /** Prompt provisional — GET /x/prompt */
  getSystemPromptForAudit() {
    return loadLocalistoXDmSystemPrompt(
      this.config.get<string>('X_DM_SYSTEM_PROMPT'),
    );
  }

  async generateReply(senderId: string, text: string): Promise<string> {
    const agentId = this.getAgentId();
    const preferRetell =
      String(this.config.get('X_DM_ENGINE') || '')
        .trim()
        .toLowerCase() !== 'local';

    if (preferRetell && agentId && this.retell) {
      try {
        return await this.replyWithRetell(agentId, senderId, text);
      } catch (err) {
        this.logger.error(
          `Retell chat falló (X_AGENT_ID=${agentId}): ${err instanceof Error ? err.message : err} — fallback OpenAI`,
        );
      }
    } else if (agentId && !this.retell) {
      this.logger.warn(
        'X_AGENT_ID definido pero falta RETELL_API_KEY — usando OpenAI',
      );
    }

    return this.replyWithLocalPrompt(senderId, text);
  }

  private async replyWithLocalPrompt(
    senderId: string,
    text: string,
  ): Promise<string> {
    if (!this.openai) {
      throw new Error(
        'OPENAI_API_KEY no configurado (necesario para DMs X sin Retell)',
      );
    }

    const { prompt: system, source } = this.getSystemPromptForAudit();
    const history = this.openAiHistory.get(senderId) || [];
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: 'system', content: system },
      ...history,
      { role: 'user', content: text },
    ];

    const model =
      this.config.get<string>('X_DM_OPENAI_MODEL')?.trim() || 'gpt-4o';
    const response = await this.openai.chat.completions.create({
      model,
      messages,
      temperature: 0.6,
      max_tokens: 400,
    });

    const reply =
      response.choices[0]?.message?.content?.trim() ||
      '¿En qué puedo ayudarte con Localicer?';

    history.push({ role: 'user', content: text });
    history.push({ role: 'assistant', content: reply });
    this.openAiHistory.set(senderId, history.slice(-12));

    this.logger.log(
      `X DM reply local source=${source} sender=${senderId} model=${model} chars=${reply.length}`,
    );
    return reply;
  }

  private async replyWithRetell(
    agentId: string,
    senderId: string,
    text: string,
  ): Promise<string> {
    let chatId = this.retellSessions.get(senderId);
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
      this.retellSessions.set(senderId, chatId);
      this.logger.log(
        `Retell chat creado chat_id=${chatId} agent=${agentId} sender=${senderId}`,
      );
    }

    const completion = await this.retell!.chat.createChatCompletion({
      chat_id: chatId,
      content: text,
    });

    const reply = this.extractAgentReplyText(completion.messages ?? []);
    if (!reply) {
      throw new Error('Retell chat completion sin mensaje de agente');
    }
    return reply;
  }

  private extractAgentReplyText(messages: readonly unknown[]): string {
    const parts: string[] = [];
    for (const raw of messages) {
      if (!raw || typeof raw !== 'object') continue;
      const msg = raw as Record<string, unknown>;
      if (msg.role !== 'agent') continue;
      if (!('content' in msg)) continue;
      if (typeof msg.content !== 'string') continue;
      const trimmed = msg.content.trim();
      if (trimmed) parts.push(trimmed);
    }
    return parts.join('\n').trim();
  }

  clearSession(senderId: string): void {
    this.retellSessions.delete(senderId);
    this.openAiHistory.delete(senderId);
  }
}
