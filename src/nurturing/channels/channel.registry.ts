import { Injectable } from '@nestjs/common';
import { Channel as PrismaChannel } from '@prisma/client';
import { Channel } from '../enums';
import { CallChannel } from './call.channel';
import { EmailChannel } from './email.channel';
import { NurturingChannel } from './channel.interface';
import { SmsChannel } from './sms.channel';
import { WhatsappChannel } from './whatsapp.channel';

@Injectable()
export class ChannelRegistry {
  private readonly byChannel: Map<string, NurturingChannel>;

  constructor(
    whatsapp: WhatsappChannel,
    email: EmailChannel,
    call: CallChannel,
    sms: SmsChannel,
  ) {
    this.byChannel = new Map<string, NurturingChannel>([
      [Channel.WHATSAPP, whatsapp],
      [Channel.EMAIL, email],
      [Channel.LLAMADA, call],
      [Channel.SMS, sms],
      [PrismaChannel.whatsapp, whatsapp],
      [PrismaChannel.email, email],
      [PrismaChannel.llamada, call],
      [PrismaChannel.sms, sms],
    ]);
  }

  get(channel: Channel | PrismaChannel | string): NurturingChannel {
    const adapter = this.byChannel.get(channel);
    if (!adapter) {
      throw new Error(`No channel adapter registered for: ${channel}`);
    }
    return adapter;
  }
}
