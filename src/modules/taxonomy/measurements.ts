const VULGAR_FRACTIONS: Record<string, string> = {
  '¼': '1/4',
  '½': '1/2',
  '¾': '3/4',
  '⅐': '1/7',
  '⅑': '1/9',
  '⅒': '1/10',
  '⅓': '1/3',
  '⅔': '2/3',
  '⅕': '1/5',
  '⅖': '2/5',
  '⅗': '3/5',
  '⅘': '4/5',
  '⅙': '1/6',
  '⅚': '5/6',
  '⅛': '1/8',
  '⅜': '3/8',
  '⅝': '5/8',
  '⅞': '7/8',
};

const VULGAR_REGEX = new RegExp(`(\\d)?([${Object.keys(VULGAR_FRACTIONS).join('')}])`, 'g');
const CM_SUFFIX_REGEX = /(?:\s|^|\d)(?:cm|cms|centimet(?:er|re)s?)\s*$/i;
const IN_SUFFIX_REGEX = /(?:\s*["″”]|''|\s*(?:in|inch|inches))\s*$/i;

function roundToTenth(value: number): number {
  return Math.round(value * 10) / 10;
}

function normalizeVulgarFractions(input: string): string {
  return input.replace(VULGAR_REGEX, (_match, leadingDigit: string | undefined, glyph: string) => {
    const slash = VULGAR_FRACTIONS[glyph];
    return leadingDigit ? `${leadingDigit} ${slash}` : slash;
  });
}

function parseNumericExpression(core: string): number | null {
  const mixedMatch = /^(\d+)\s+(\d+)\s*\/\s*(\d+)$/.exec(core);
  if (mixedMatch) {
    const whole = Number.parseInt(mixedMatch[1], 10);
    const num = Number.parseInt(mixedMatch[2], 10);
    const den = Number.parseInt(mixedMatch[3], 10);
    if (den <= 0) return null;
    return whole + num / den;
  }

  const fractionMatch = /^(\d+)\s*\/\s*(\d+)$/.exec(core);
  if (fractionMatch) {
    const num = Number.parseInt(fractionMatch[1], 10);
    const den = Number.parseInt(fractionMatch[2], 10);
    if (den <= 0) return null;
    return num / den;
  }

  const decimalMatch = /^(\d+(?:\.\d+)?|\.\d+)$/.exec(core);
  if (decimalMatch) {
    return Number.parseFloat(decimalMatch[1]);
  }

  return null;
}

/**
 * Parses decimal inches, unicode/slash fractions, and cm measurements into canonical inches
 * rounded to 1 decimal place. Returns null for empty, non-positive, or unparseable inputs.
 */
export function parseMeasurementInches(
  raw: string | number | null | undefined,
  unitHint?: 'in' | 'cm'
): number | null {
  if (raw === null || raw === undefined) return null;

  if (typeof raw === 'number') {
    if (!Number.isFinite(raw) || raw <= 0) return null;
    const inches = unitHint === 'cm' ? raw / 2.54 : raw;
    return roundToTenth(inches);
  }

  const trimmed = raw.trim();
  if (!trimmed) return null;

  const normalized = normalizeVulgarFractions(trimmed);

  let detectedUnit: 'in' | 'cm' = unitHint ?? 'in';
  let numericCore = normalized;

  if (CM_SUFFIX_REGEX.test(normalized)) {
    detectedUnit = 'cm';
    numericCore = normalized.replace(/\s*(?:cm|cms|centimet(?:er|re)s?)\s*$/i, '').trim();
  } else if (IN_SUFFIX_REGEX.test(normalized)) {
    detectedUnit = 'in';
    numericCore = normalized.replace(/(?:\s*["″”]|\s*''|\s*(?:in|inch|inches))\s*$/i, '').trim();
  }

  const parsedValue = parseNumericExpression(numericCore);
  if (parsedValue === null || !Number.isFinite(parsedValue) || parsedValue <= 0) {
    return null;
  }

  const inches = detectedUnit === 'cm' ? parsedValue / 2.54 : parsedValue;
  return roundToTenth(inches);
}

/**
 * Parses a min/max measurement pair into canonical inch bounds, throwing if either
 * endpoint cannot be parsed or if maxIn < minIn.
 */
export function normalizeMeasurementSpan(
  minRaw: string | number,
  maxRaw: string | number,
  unitHint?: 'in' | 'cm'
): { minIn: number; maxIn: number } {
  const minIn = parseMeasurementInches(minRaw, unitHint);
  if (minIn === null) {
    throw new Error(`Invalid minimum measurement bound: ${String(minRaw)}`);
  }

  const maxIn = parseMeasurementInches(maxRaw, unitHint);
  if (maxIn === null) {
    throw new Error(`Invalid maximum measurement bound: ${String(maxRaw)}`);
  }

  if (maxIn < minIn) {
    throw new Error(`Maximum measurement (${maxIn}") cannot be less than minimum (${minIn}")`);
  }

  return { minIn, maxIn };
}
