import { Logger } from '@nestjs/common';
import { createTwilioMessageWithTemplateFallback } from './twilio-template-fallback';

describe('createTwilioMessageWithTemplateFallback', () => {
  const logger = {
    warn: jest.fn(),
  } as unknown as Logger;

  it('usa body directo si no hay contentSid', async () => {
    const create = jest.fn().mockResolvedValue({ sid: 'SM1' });
    const client = { messages: { create } } as any;
    await createTwilioMessageWithTemplateFallback(
      client,
      { from: '+1', to: '+2', body: 'hola' },
      logger,
      'SmsService',
    );
    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith({
      from: '+1',
      to: '+2',
      body: 'hola',
    });
  });

  it('reintenta con texto libre si la plantilla oficial falla', async () => {
    const create = jest
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error('template invalid'), { code: 21656 }))
      .mockResolvedValueOnce({ sid: 'SM2' });
    const client = { messages: { create } } as any;
    const result = await createTwilioMessageWithTemplateFallback(
      client,
      {
        from: '+1',
        to: '+2',
        body: 'Hola Toni! fallback',
        contentSid: 'HXabc',
        contentVariables: JSON.stringify({ '1': 'Local en Palma' }),
      },
      logger,
      'WhatsAppService',
    );
    expect(result.sid).toBe('SM2');
    expect(create).toHaveBeenNthCalledWith(1, {
      from: '+1',
      to: '+2',
      contentSid: 'HXabc',
      contentVariables: JSON.stringify({ '1': 'Local en Palma' }),
    });
    expect(create).toHaveBeenNthCalledWith(2, {
      from: '+1',
      to: '+2',
      body: 'Hola Toni! fallback',
    });
    expect(logger.warn).toHaveBeenCalled();
  });
});
