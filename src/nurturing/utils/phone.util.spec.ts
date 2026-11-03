import {
  collapseDuplicateCountryPrefixes,
  extractSpanishMobileDigits,
  formatE164Spain,
  normalizePhone,
  phoneDedupeKey,
} from './phone.util';

describe('phone.util', () => {
  describe('formatE164Spain', () => {
    it('normaliza móvil español clásico', () => {
      expect(formatE164Spain('644408099')).toBe('+34644408099');
      expect(formatE164Spain('+34644408099')).toBe('+34644408099');
      expect(formatE164Spain('34644408099')).toBe('+34644408099');
    });

    it('elimina prefijos duplicados +34+34', () => {
      expect(formatE164Spain('+34+34644408099')).toBe('+34644408099');
      expect(formatE164Spain('3434644408099')).toBe('+34644408099');
    });

    it('elimina prefijos encadenados +34+31…', () => {
      expect(formatE164Spain('+34+31644408099')).toBe('+34644408099');
      expect(formatE164Spain('+34+31 644 408 099')).toBe('+34644408099');
    });

    it('acepta whatsapp:', () => {
      expect(formatE164Spain('whatsapp:+34644408099')).toBe('+34644408099');
    });
  });

  describe('collapseDuplicateCountryPrefixes', () => {
    it('colapsa 3434…', () => {
      expect(collapseDuplicateCountryPrefixes('3434644408099')).toBe(
        '34644408099',
      );
    });

    it('colapsa 3431…', () => {
      expect(collapseDuplicateCountryPrefixes('3431644408099')).toBe(
        '31644408099',
      );
    });
  });

  describe('extractSpanishMobileDigits', () => {
    it('extrae móvil del final tras basura de prefijos', () => {
      expect(extractSpanishMobileDigits('31644408099')).toBe('644408099');
    });
  });

  describe('normalizePhone / phoneDedupeKey', () => {
    it('dedupe por dígitos', () => {
      expect(phoneDedupeKey('+34 644 408 099')).toBe('34644408099');
      expect(normalizePhone('whatsapp:+34644408099')).toBe('+34644408099');
    });
  });
});
