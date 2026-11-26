import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Retell from 'retell-sdk';
import { RetellWebhookGuard } from './retell-webhook.guard';

function makeContext(req: {
  headers?: Record<string, string | undefined>;
  rawBody?: Buffer | string;
  body?: unknown;
  path?: string;
}): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({
        headers: req.headers ?? {},
        rawBody: req.rawBody,
        body: req.body,
        path: req.path ?? '/webhooks/retell',
      }),
    }),
  } as unknown as ExecutionContext;
}

describe('RetellWebhookGuard', () => {
  const apiKey = 'key_test_retell_api_secret_12345';
  const webhookSecret = 'whsec_localicer_secret_98765';

  const makeGuard = (env: Record<string, string | undefined>) =>
    new RetellWebhookGuard({
      get: (key: string) => env[key],
    } as unknown as ConfigService);

  it('permite un webhook con firma oficial x-retell-signature válida sobre rawBody', async () => {
    const guard = makeGuard({
      RETELL_API_KEY: apiKey,
      RETELL_WEBHOOK_SECRET: webhookSecret,
    });
    const payload = JSON.stringify({
      event: 'call_analyzed',
      call: { call_id: 'c1' },
    });
    const signature = await Retell.sign(payload, apiKey);

    await expect(
      guard.canActivate(
        makeContext({
          headers: { 'x-retell-signature': signature },
          rawBody: Buffer.from(payload, 'utf8'),
          body: JSON.parse(payload),
        }),
      ),
    ).resolves.toBe(true);
  });

  it('permite una llamada con cabecera secreta x-localicer-tool-key válida', async () => {
    const guard = makeGuard({
      RETELL_API_KEY: apiKey,
      RETELL_WEBHOOK_SECRET: webhookSecret,
    });

    await expect(
      guard.canActivate(
        makeContext({
          headers: { 'x-localicer-tool-key': webhookSecret },
          path: '/webhooks/retell/agendar-llamada',
        }),
      ),
    ).resolves.toBe(true);
  });

  it('permite Authorization Bearer con RETELL_WEBHOOK_SECRET', async () => {
    const guard = makeGuard({
      RETELL_WEBHOOK_SECRET: webhookSecret,
    });

    await expect(
      guard.canActivate(
        makeContext({
          headers: { authorization: `Bearer ${webhookSecret}` },
        }),
      ),
    ).resolves.toBe(true);
  });

  it('rechaza con 401 si la firma x-retell-signature es inválida y no hay secreto', async () => {
    const guard = makeGuard({
      RETELL_API_KEY: apiKey,
      RETELL_WEBHOOK_SECRET: webhookSecret,
    });
    const payload = JSON.stringify({ event: 'call_ended' });

    await expect(
      guard.canActivate(
        makeContext({
          headers: { 'x-retell-signature': 'v=1,d=invalida' },
          rawBody: Buffer.from(payload, 'utf8'),
          body: JSON.parse(payload),
        }),
      ),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('rechaza con 401 si la firma corresponde a otro payload (manipulado)', async () => {
    const guard = makeGuard({
      RETELL_API_KEY: apiKey,
      RETELL_WEBHOOK_SECRET: webhookSecret,
    });
    const original = JSON.stringify({ event: 'call_ended', call: { call_id: 'c1' } });
    const tampered = JSON.stringify({ event: 'call_ended', call: { call_id: 'c2' } });
    const signature = await Retell.sign(original, apiKey);

    await expect(
      guard.canActivate(
        makeContext({
          headers: { 'x-retell-signature': signature },
          rawBody: Buffer.from(tampered, 'utf8'),
          body: JSON.parse(tampered),
        }),
      ),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('rechaza con 401 si no viene ni firma ni secreto', async () => {
    const guard = makeGuard({
      RETELL_API_KEY: apiKey,
      RETELL_WEBHOOK_SECRET: webhookSecret,
    });

    await expect(guard.canActivate(makeContext({}))).rejects.toThrow(
      UnauthorizedException,
    );
  });
});
