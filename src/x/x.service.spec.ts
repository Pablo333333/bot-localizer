import { createHmac } from 'crypto';
import { buildCrcResponseToken, percentEncode } from './x-oauth';
import {
  isXInboundAutoReplyEnabled,
  resolveXCredentials,
} from './x-inbound-enabled';

jest.mock('./x-chat.service', () => ({
  XChatService: jest.fn().mockImplementation(() => ({
    getAgentId: jest.fn(() => 'agent_x_chat'),
    generateReply: jest.fn(),
    getSystemPromptForAudit: jest.fn(() => ({
      source: 'fallback:generic',
      prompt: 'test prompt',
      editableVia: 'env_for_now_sheets_or_db_later',
    })),
  })),
}));

import { XService } from './x.service';

describe('x-oauth', () => {
  it('percentEncode deja alfanuméricos', () => {
    expect(percentEncode('abc123')).toBe('abc123');
  });

  it('buildCrcResponseToken firma HMAC-SHA256', () => {
    const token = 'test_crc';
    const secret = 'consumer_secret';
    const expected =
      'sha256=' +
      createHmac('sha256', secret).update(token).digest('base64');
    expect(buildCrcResponseToken(token, secret)).toBe(expected);
  });
});

describe('x-inbound-enabled', () => {
  it('por defecto true si hay agent id', () => {
    expect(isXInboundAutoReplyEnabled(undefined, true)).toBe(true);
    expect(isXInboundAutoReplyEnabled(undefined, false)).toBe(false);
  });

  it('respeta false explícito', () => {
    expect(isXInboundAutoReplyEnabled('false', true)).toBe(false);
  });

  it('resolveXCredentials usa alias legacy', () => {
    const map: Record<string, string> = {
      X_CONSUMER_KEY: 'k',
      X_CONSUMER_SECRET: 's',
      X_ACCESS_TOKEN: 't',
      X_ACCESS_TOKEN_SECRET: 'ts',
    };
    expect(resolveXCredentials((k) => map[k])).toEqual({
      apiKey: 'k',
      apiSecret: 's',
      accessToken: 't',
      accessSecret: 'ts',
    });
  });
});

describe('XService parseIncomingDms', () => {
  const configGet = jest.fn((key: string) => {
    if (key === 'X_BOT_USER_ID') return 'bot-1';
    return undefined;
  });
  const config = { get: configGet };
  const chat = {
    getAgentId: jest.fn(() => 'agent_x_chat'),
    generateReply: jest.fn(),
  };
  const service = new XService(config as any, chat as any);

  beforeEach(() => {
    configGet.mockImplementation((key: string) => {
      if (key === 'X_BOT_USER_ID') return 'bot-1';
      return undefined;
    });
  });

  it('extrae DM de Account Activity y marca echo del bot', () => {
    const parsed = service.parseIncomingDms({
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
        {
          type: 'message_create',
          id: 'evt-2',
          message_create: {
            sender_id: 'bot-1',
            target: { recipient_id: 'user-9' },
            message_data: { text: 'respuesta bot' },
          },
        },
      ],
    });

    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toMatchObject({
      senderId: 'user-9',
      text: 'Hola Localisto',
      isEcho: false,
    });
    expect(parsed[1].isEcho).toBe(true);
  });

  it('ignora eventos que no son message_create', () => {
    const parsed = service.parseIncomingDms({
      direct_message_events: [{ type: 'participants_join', id: 'x' }],
      tweet_create_events: [{ id: 'tweet' }],
    });
    expect(parsed).toHaveLength(0);
  });

  it('sendDirectMessage falla sin credenciales', async () => {
    const result = await service.sendDirectMessage('user-1', 'hola');
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Credenciales X incompletas/);
  });

  it('verifyCrc genera response_token', () => {
    configGet.mockImplementation((key: string) =>
      key === 'X_API_SECRET' ? 'secret' : undefined,
    );
    const token = service.verifyCrc('crc123');
    expect(token?.startsWith('sha256=')).toBe(true);
  });
});
