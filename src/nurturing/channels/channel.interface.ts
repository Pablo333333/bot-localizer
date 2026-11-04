import { Channel } from '../enums';

export interface ChannelSendPayload {
  leadId: string;
  phone: string;
  email?: string | null;
  name?: string | null;
  templateKey: string;
  templatePayload?: Record<string, unknown> | null;
  stepRunId: string;
}

export interface ChannelSendResult {
  success: boolean;
  providerRef?: string;
  error?: string;
  /** El proveedor no pudo cobrar (sin saldo). El paso sigue en cola. */
  hold?: 'provider_balance';
  /**
   * Fallo terminal (p.ej. Twilio 63007): no reintentar ni caer a SMS.
   * El processor marca el stepRun como failed sin saturar BullMQ.
   */
  permanent?: boolean;
}

export interface NurturingChannel {
  readonly channel: Channel;
  send(payload: ChannelSendPayload): Promise<ChannelSendResult>;
}
