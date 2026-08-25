import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface XIncomingDm {
  senderId: string | null;
  recipientId: string | null;
  text: string | null;
  messageId?: string | null;
}

/**
 * Stub: envío y recepción de DMs de X (Twitter API v2).
 * Implementación real pendiente (OAuth 2.0 + account activity / DM events).
 */
@Injectable()
export class XService {
  private readonly logger = new Logger(XService.name);

  constructor(private readonly config: ConfigService) {}

  /** Stub: no envía aún. */
  async sendDirectMessage(
    recipientId: string,
    text: string,
  ): Promise<{ success: boolean; error?: string }> {
    const token = this.config.get<string>('X_ACCESS_TOKEN');
    if (!token) {
      const error = 'X_ACCESS_TOKEN no configurado (stub)';
      this.logger.warn(`X sendDirectMessage: ${error}`);
      return { success: false, error };
    }

    this.logger.log(
      `[STUB X DM] send skipped recipient=${recipientId} chars=${text?.length ?? 0}`,
    );
    return {
      success: false,
      error: 'X DM Send API not implemented yet (stub)',
    };
  }

  /**
   * Stub: loguea el evento y no responde automáticamente
   * (misma política anti-colisión que Meta/GHL).
   */
  async handleIncomingDm(payload: unknown): Promise<void> {
    this.logger.log(
      `[STUB X DM] inbound event received keys=${Object.keys((payload as object) || {}).join(',')}`,
    );
    this.logger.debug(`[STUB X DM] payload=${JSON.stringify(payload)}`);
  }
}
