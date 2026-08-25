import { XService } from './x.service';

describe('XService (stub)', () => {
  const config = {
    get: jest.fn((key: string) =>
      key === 'X_ACCESS_TOKEN' ? undefined : undefined,
    ),
  };
  const service = new XService(config as any);

  it('sendDirectMessage falla sin token (stub)', async () => {
    const result = await service.sendDirectMessage('user-1', 'hola');
    expect(result.success).toBe(false);
    expect(result.error).toContain('X_ACCESS_TOKEN');
  });

  it('handleIncomingDm no lanza', async () => {
    await expect(
      service.handleIncomingDm({ direct_message_events: [] }),
    ).resolves.toBeUndefined();
  });
});
