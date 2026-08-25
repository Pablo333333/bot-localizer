import {
  META_INBOUND_DISABLED_LOG,
  isMetaInboundAutoReplyEnabled,
} from './meta-inbound-enabled';

describe('isMetaInboundAutoReplyEnabled', () => {
  it('está OFF por defecto (evita colisión con GHL)', () => {
    expect(isMetaInboundAutoReplyEnabled(undefined)).toBe(false);
    expect(isMetaInboundAutoReplyEnabled(null)).toBe(false);
    expect(isMetaInboundAutoReplyEnabled('')).toBe(false);
    expect(isMetaInboundAutoReplyEnabled('false')).toBe(false);
  });

  it('solo se activa con true/1/yes/si', () => {
    expect(isMetaInboundAutoReplyEnabled(true)).toBe(true);
    expect(isMetaInboundAutoReplyEnabled('true')).toBe(true);
    expect(isMetaInboundAutoReplyEnabled('1')).toBe(true);
    expect(isMetaInboundAutoReplyEnabled('yes')).toBe(true);
  });

  it('mensaje de log estable', () => {
    expect(META_INBOUND_DISABLED_LOG).toContain('GoHighLevel');
  });
});
