import { Logger } from '@nestjs/common';
import { Twilio } from 'twilio';
import type { MessageInstance } from 'twilio/lib/rest/api/v2010/account/message';

type TwilioCreateParams = {
  from: string;
  to: string;
  body?: string;
  contentSid?: string;
  contentVariables?: string;
};

/**
 * Intenta Content Template Twilio; si falla, reenvía el mismo mensaje como body libre.
 */
export async function createTwilioMessageWithTemplateFallback(
  client: Twilio,
  params: TwilioCreateParams,
  logger: Logger,
  channelLabel: string,
): Promise<MessageInstance> {
  const { body, contentSid, contentVariables, ...rest } = params;
  if (!contentSid) {
    return client.messages.create({ ...rest, body });
  }

  try {
    return await client.messages.create({
      ...rest,
      contentSid,
      ...(contentVariables ? { contentVariables } : {}),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const twilioCode = (error as { code?: number })?.code;
    logger.warn(
      `[${channelLabel}] Plantilla oficial falló` +
        (twilioCode != null ? ` code=${twilioCode}` : '') +
        ` — fallback a texto libre to=${params.to}: ${message}`,
    );
    if (!body?.trim()) {
      throw error;
    }
    return client.messages.create({ ...rest, body });
  }
}
