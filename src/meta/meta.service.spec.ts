jest.mock('axios');
jest.mock('../v2/inbound.service', () => ({
  InboundService: class InboundService {},
}));

import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { InboundService } from '../v2/inbound.service';
import { MetaService } from './meta.service';

const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('MetaService', () => {
  const accessToken = 'test-page-token';
  let inbound: { handleIncomingMessage: jest.Mock };
  let config: { get: jest.Mock };
  let service: MetaService;

  const envMap: Record<string, string | undefined> = {
    META_PAGE_ACCESS_TOKEN: accessToken,
    // Por defecto OFF (GHL posee el inbox)
    META_INBOUND_AUTO_REPLY: undefined,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    envMap.META_PAGE_ACCESS_TOKEN = accessToken;
    envMap.META_INBOUND_AUTO_REPLY = undefined;
    inbound = {
      handleIncomingMessage: jest
        .fn()
        .mockResolvedValue('Hola, soy Localisto. ¿En qué te ayudo?'),
    };
    config = {
      get: jest.fn((key: string) => envMap[key]),
    };
    service = new MetaService(
      config as unknown as ConfigService,
      inbound as unknown as InboundService,
    );
  });

  describe('sendMessage', () => {
    it('POST a Graph API con access_token y cuerpo RESPONSE', async () => {
      mockedAxios.post.mockResolvedValueOnce({
        data: { recipient_id: 'PSID_1', message_id: 'mid.abc' },
      });

      const result = await service.sendMessage(
        'PSID_1',
        'Hola desde Localisto',
        'messenger',
      );

      expect(result).toEqual({ success: true, messageId: 'mid.abc' });
      expect(mockedAxios.post).toHaveBeenCalledTimes(1);
      expect(mockedAxios.post).toHaveBeenCalledWith(
        'https://graph.facebook.com/v19.0/me/messages',
        {
          recipient: { id: 'PSID_1' },
          messaging_type: 'RESPONSE',
          message: { text: 'Hola desde Localisto' },
        },
        expect.objectContaining({
          params: { access_token: accessToken },
        }),
      );
    });

    it('falla sin META_PAGE_ACCESS_TOKEN y no llama a axios', async () => {
      envMap.META_PAGE_ACCESS_TOKEN = undefined;

      const result = await service.sendMessage('PSID_1', 'hola', 'instagram');

      expect(result.success).toBe(false);
      expect(result.error).toContain('META_PAGE_ACCESS_TOKEN');
      expect(mockedAxios.post).not.toHaveBeenCalled();
    });

    it('loguea y retorna error si Graph API responde con fallo', async () => {
      mockedAxios.post.mockRejectedValueOnce({
        response: {
          data: { error: { message: 'Invalid OAuth access token' } },
        },
        message: 'Request failed',
      });

      const result = await service.sendMessage('PSID_1', 'hola', 'messenger');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid OAuth access token');
    });
  });

  describe('handleIncomingMessage', () => {
    const messengerPayload = {
      object: 'page',
      entry: [
        {
          id: 'PAGE_ID',
          messaging: [
            {
              sender: { id: 'USER_PSID' },
              recipient: { id: 'PAGE_ID' },
              timestamp: 1_700_000_000_000,
              message: { mid: 'mid.user', text: 'Busco un local en Palma' },
            },
          ],
        },
      ],
    };

    it('por defecto (GHL): loguea y NO llama inbound ni Send API', async () => {
      await service.handleIncomingMessage(messengerPayload);

      expect(inbound.handleIncomingMessage).not.toHaveBeenCalled();
      expect(mockedAxios.post).not.toHaveBeenCalled();
    });

    it('con META_INBOUND_AUTO_REPLY=true: inbound + sendMessage', async () => {
      envMap.META_INBOUND_AUTO_REPLY = 'true';
      mockedAxios.post.mockResolvedValueOnce({
        data: { message_id: 'mid.bot' },
      });

      await service.handleIncomingMessage(messengerPayload);

      expect(inbound.handleIncomingMessage).toHaveBeenCalledWith(
        'meta:messenger:USER_PSID',
        'Busco un local en Palma',
      );
      expect(mockedAxios.post).toHaveBeenCalledWith(
        'https://graph.facebook.com/v19.0/me/messages',
        expect.objectContaining({
          recipient: { id: 'USER_PSID' },
          message: {
            text: 'Hola, soy Localisto. ¿En qué te ayudo?',
          },
        }),
        expect.any(Object),
      );
    });

    it('ignora echoes del bot', async () => {
      envMap.META_INBOUND_AUTO_REPLY = 'true';

      await service.handleIncomingMessage({
        object: 'page',
        entry: [
          {
            messaging: [
              {
                sender: { id: 'PAGE_ID' },
                recipient: { id: 'USER_PSID' },
                message: { is_echo: true, text: 'eco' },
              },
            ],
          },
        ],
      });

      expect(inbound.handleIncomingMessage).not.toHaveBeenCalled();
      expect(mockedAxios.post).not.toHaveBeenCalled();
    });
  });

  describe('parseIncomingMessages', () => {
    it('extrae sender, recipient, texto y plataforma', () => {
      const parsed = service.parseIncomingMessages({
        object: 'page',
        entry: [
          {
            messaging: [
              {
                sender: { id: 'A' },
                recipient: { id: 'B' },
                message: { text: 'hola', mid: 'm1' },
                timestamp: 123,
              },
            ],
          },
        ],
      });

      expect(parsed).toEqual([
        {
          platform: 'messenger',
          senderId: 'A',
          recipientId: 'B',
          text: 'hola',
          mid: 'm1',
          timestamp: 123,
        },
      ]);
    });
  });
});
