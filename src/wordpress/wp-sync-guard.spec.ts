import {
  isWpSyncProtectPublishedEnabled,
  shouldSkipWpOverwrite,
} from './wp-sync-guard';

describe('wp-sync-guard', () => {
  it('protege publicados por defecto', () => {
    expect(isWpSyncProtectPublishedEnabled(undefined)).toBe(true);
    expect(isWpSyncProtectPublishedEnabled('false')).toBe(false);
  });

  it('omite overwrite de publish sin forzar', () => {
    expect(
      shouldSkipWpOverwrite({
        existingPostId: 33595,
        wpStatus: 'publish',
        protectPublished: true,
        forzarSync: false,
        bloquearSync: false,
      }).skip,
    ).toBe(true);
  });

  it('permite overwrite con Forzar sync', () => {
    expect(
      shouldSkipWpOverwrite({
        existingPostId: 33595,
        wpStatus: 'publish',
        protectPublished: true,
        forzarSync: true,
        bloquearSync: false,
      }).skip,
    ).toBe(false);
  });

  it('Bloquear sync gana siempre', () => {
    expect(
      shouldSkipWpOverwrite({
        existingPostId: 33595,
        wpStatus: 'draft',
        protectPublished: true,
        forzarSync: true,
        bloquearSync: true,
      }).skip,
    ).toBe(true);
  });
});
