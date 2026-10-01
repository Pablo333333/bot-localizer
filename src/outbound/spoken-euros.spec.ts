import { toSpokenEuros } from './spoken-euros';

describe('toSpokenEuros', () => {
  it('dice la cantidad, no los dígitos', () => {
    expect(toSpokenEuros('100000')).toBe('cien mil euros');
    expect(toSpokenEuros('125000')).toBe('ciento veinticinco mil euros');
    expect(toSpokenEuros('125.000 €')).toBe('ciento veinticinco mil euros');
    expect(toSpokenEuros('1.500')).toBe('mil quinientos euros');
    expect(toSpokenEuros('1800')).toBe('mil ochocientos euros');
    expect(toSpokenEuros('21')).toBe('veintiún euros');
    expect(toSpokenEuros('1')).toBe('un euro');
    expect(toSpokenEuros('1000000')).toBe('un millón de euros');
    expect(toSpokenEuros('2500000')).toBe('dos millones quinientos mil euros');
    expect(toSpokenEuros('121000')).toBe('ciento veintiún mil euros');
  });

  it('un cero no se pronuncia y el texto libre se conserva', () => {
    expect(toSpokenEuros('0')).toBe('');
    expect(toSpokenEuros('0 €')).toBe('');
    expect(toSpokenEuros('')).toBe('');
    expect(toSpokenEuros('a consultar')).toBe('a consultar');
  });
});
