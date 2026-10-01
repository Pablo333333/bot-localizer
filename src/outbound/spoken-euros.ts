/**
 * Cantidades para que la voz las diga como precio, no cifra a cifra.
 * "100000" en Cartesia/Retell suena "uno cero cero cero cero cero".
 * "cien mil euros" se lee como cantidad.
 */

const UNITS = [
  '',
  'uno',
  'dos',
  'tres',
  'cuatro',
  'cinco',
  'seis',
  'siete',
  'ocho',
  'nueve',
];

const TEENS = [
  'diez',
  'once',
  'doce',
  'trece',
  'catorce',
  'quince',
  'dieciséis',
  'diecisiete',
  'dieciocho',
  'diecinueve',
];

const TENS = [
  '',
  '',
  'veinte',
  'treinta',
  'cuarenta',
  'cincuenta',
  'sesenta',
  'setenta',
  'ochenta',
  'noventa',
];

const TWENTIES = [
  '',
  'veintiuno',
  'veintidós',
  'veintitrés',
  'veinticuatro',
  'veinticinco',
  'veintiséis',
  'veintisiete',
  'veintiocho',
  'veintinueve',
];

const HUNDREDS = [
  '',
  'ciento',
  'doscientos',
  'trescientos',
  'cuatrocientos',
  'quinientos',
  'seiscientos',
  'setecientos',
  'ochocientos',
  'novecientos',
];

/** Vacío, cero o texto que no es un importe. El texto no numérico se devuelve igual. */
export function toSpokenEuros(raw: unknown): string {
  const original = String(raw ?? '').trim();
  if (!original) return '';
  const amount = parseEuroAmount(original);
  if (amount === null) return '';
  if (amount === undefined) return original;
  return formatEuros(amount);
}

function parseEuroAmount(raw: string): number | null | undefined {
  let s = raw
    .toLowerCase()
    .replace(/€/g, '')
    .replace(/euros?/g, '')
    .replace(/\/?\s*mes/g, '')
    .replace(/\s/g, '');
  if (!s) return undefined;
  if (!/^[\d.,]+$/.test(s)) return undefined;

  if (s.includes('.') && s.includes(',')) {
    s = s.replace(/\./g, '').replace(',', '.');
  } else if (/^\d{1,3}(\.\d{3})+$/.test(s)) {
    s = s.replace(/\./g, '');
  } else if (/^\d{1,3}(,\d{3})+$/.test(s)) {
    s = s.replace(/,/g, '');
  } else if (s.includes(',')) {
    s = s.replace(',', '.');
  }

  if (!/^\d+(\.\d+)?$/.test(s)) return undefined;
  const n = Number(s);
  if (!Number.isFinite(n) || n <= 0) return null;
  if (n >= 1_000_000_000) return undefined;
  return n;
}

function formatEuros(amount: number): string {
  let euros = Math.floor(amount + 1e-8);
  let cents = Math.round((amount - euros) * 100);
  if (cents === 100) {
    euros += 1;
    cents = 0;
  }
  const exactMillions = euros >= 1_000_000 && euros % 1_000_000 === 0;
  const words = spell(euros, true);
  const noun = euros === 1 ? 'euro' : 'euros';
  const de = exactMillions ? ' de' : '';
  let phrase = `${words}${de} ${noun}`;
  if (cents > 0) {
    const centWords = spell(cents, true);
    const centNoun = cents === 1 ? 'céntimo' : 'céntimos';
    phrase += ` con ${centWords} ${centNoun}`;
  }
  return phrase;
}

/** apocope: un / veintiún / treinta y un, delante de mil, millón o euro. */
function spell(n: number, apocope: boolean): string {
  if (n <= 0) return '';
  if (n >= 1_000_000) {
    const millions = Math.floor(n / 1_000_000);
    const rest = n % 1_000_000;
    const head =
      millions === 1 ? 'un millón' : `${spell(millions, true)} millones`;
    if (!rest) return head;
    return `${head} ${spellBelowMillion(rest, apocope)}`;
  }
  return spellBelowMillion(n, apocope);
}

function spellBelowMillion(n: number, apocope: boolean): string {
  if (n < 1000) return spellBelowThousand(n, apocope);
  const thousands = Math.floor(n / 1000);
  const rest = n % 1000;
  const head = thousands === 1 ? 'mil' : `${spellBelowThousand(thousands, true)} mil`;
  if (!rest) return head;
  return `${head} ${spellBelowThousand(rest, apocope)}`;
}

function spellBelowThousand(n: number, apocope: boolean): string {
  if (n === 100) return 'cien';
  if (n < 100) return spellBelowHundred(n, apocope);
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  const head = HUNDREDS[hundreds];
  if (!rest) return head;
  return `${head} ${spellBelowHundred(rest, apocope)}`;
}

function spellBelowHundred(n: number, apocope: boolean): string {
  if (n < 10) {
    if (n === 1) return apocope ? 'un' : 'uno';
    return UNITS[n];
  }
  if (n < 20) return TEENS[n - 10];
  if (n < 30) {
    if (n === 20) return 'veinte';
    if (n === 21) return apocope ? 'veintiún' : 'veintiuno';
    return TWENTIES[n - 20];
  }
  const ten = Math.floor(n / 10);
  const unit = n % 10;
  if (!unit) return TENS[ten];
  const tail = unit === 1 ? (apocope ? 'un' : 'uno') : UNITS[unit];
  return `${TENS[ten]} y ${tail}`;
}
