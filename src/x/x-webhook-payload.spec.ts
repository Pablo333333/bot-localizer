import {
  coerceJsonBody,
  parseIncomingDmsFromPayload,
  resolveWebhookBotUserId,
  userIdFromAccessToken,
} from './x-webhook-payload';

describe('x-webhook-payload', () => {
  const classicInbound = {
    for_user_id: 'bot-1',
    direct_message_events: [
      {
        type: 'message_create',
        id: 'evt-1',
        message_create: {
          sender_id: 'user-9',
          target: { recipient_id: 'bot-1' },
          message_data: { text: 'Hola Localisto' },
        },
      },
    ],
  };

  it('extrae texto de Account Activity clásico', () => {
    const parsed = parseIncomingDmsFromPayload(classicInbound, 'bot-1');
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({
      senderId: 'user-9',
      text: 'Hola Localisto',
      isEcho: false,
    });
  });

  it('usa for_user_id del payload aunque X_BOT_USER_ID sea el tester', () => {
    const bot = resolveWebhookBotUserId({
      payload: classicInbound,
      envBotUserId: 'user-9',
    });
    expect(bot.botUserId).toBe('bot-1');
    const parsed = parseIncomingDmsFromPayload(classicInbound, bot.botUserId);
    expect(parsed[0].isEcho).toBe(false);
  });

  it('parsea XAA anidado data.payload.direct_message_events (dm.received)', () => {
    const parsed = parseIncomingDmsFromPayload(
      {
        data: {
          event_type: 'dm.received',
          filter: { user_id: '111' },
          payload: {
            direct_message_events: [
              {
                type: 'message_create',
                id: '208',
                message_create: {
                  sender_id: '222',
                  target: { recipient_id: '111' },
                  message_data: { text: 'hello!' },
                },
              },
            ],
          },
        },
      },
      '111',
    );
    expect(parsed).toHaveLength(1);
    expect(parsed[0].text).toBe('hello!');
    expect(parsed[0].senderId).toBe('222');
    expect(parsed[0].isEcho).toBe(false);
  });

  it('marca dm.sent / sender=bot como echo', () => {
    const parsed = parseIncomingDmsFromPayload(
      {
        data: {
          event_type: 'dm.sent',
          filter: { user_id: '111' },
          payload: {
            direct_message_events: [
              {
                type: 'message_create',
                id: '209',
                message_create: {
                  sender_id: '111',
                  target: { recipient_id: '222' },
                  message_data: { text: 'respuesta bot' },
                },
              },
            ],
          },
        },
      },
      '111',
    );
    expect(parsed[0].isEcho).toBe(true);
  });

  it('lee user id del prefijo de X_ACCESS_TOKEN', () => {
    expect(userIdFromAccessToken('9988776655-abcXYZ')).toBe('9988776655');
    expect(
      resolveWebhookBotUserId({
        payload: {},
        accessToken: '9988776655-abcXYZ',
      }).botUserId,
    ).toBe('9988776655');
  });

  it('coerceJsonBody usa rawBody si @Body llega vacío', () => {
    const raw = Buffer.from(JSON.stringify(classicInbound), 'utf8');
    const parsed = coerceJsonBody({}, raw);
    expect(parsed.for_user_id).toBe('bot-1');
  });
});
