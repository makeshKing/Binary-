// lib/currency.ts
// Centralized decimal-safe (BigInt fixed-point) currency conversion & formatting helper.
// All stored money in the database is in base units (USDT, 2 decimal places).
// Never use floating-point arithmetic for monetary conversion or rounding.

export type CurrencyCode = 'USDT' | 'NPR';

export interface CurrencyConfig {
  code: CurrencyCode;
  symbol: string;
  decimals: 2;
  is_active: boolean;
  display_order: number;
}

export interface ExchangeRateRecord {
  id: string;
  base: 'USDT';
  quote: 'NPR';
  rate: number; // numeric(12,4) e.g. 134.5000
  reason: string;
  set_by: string | null;
  set_by_email?: string | null;
  created_at: string;
}

export const DEFAULT_USDT_NPR_RATE = 134.5;

export const CURRENCY_CONFIGS: Record<CurrencyCode, CurrencyConfig> = {
  USDT: {
    code: 'USDT',
    symbol: '$',
    decimals: 2,
    is_active: true,
    display_order: 1,
  },
  NPR: {
    code: 'NPR',
    symbol: 'Rs ',
    decimals: 2,
    is_active: true,
    display_order: 2,
  },
};

// Internal fixed-point scales:
// - Money amounts (USDT / NPR): 2 decimal places (cents / paisa, scale = 100n)
// - Exchange rates (numeric(12,4)): 4 decimal places (scale = 10_000n)
const CENTS_SCALE = BigInt(100);
const RATE_SCALE = BigInt(10000);

/**
 * Parses a decimal string or number into a scaled BigInt with `decimals` fractional digits
 * using deterministic half-up rounding, avoiding IEEE-754 floating-point multiplication.
 */
export function parseDecimalToScaledBigInt(
  value: string | number | null | undefined,
  decimals: number
): bigint {
  if (value === null || value === undefined) return BigInt(0);
  const rawStr =
    typeof value === 'number'
      ? Number.isFinite(value)
        ? value.toFixed(Math.max(decimals + 4, 6))
        : '0'
      : String(value).trim();

  const cleaned = rawStr.replace(/,/g, '').trim();
  if (!cleaned || !/^[+-]?\d*(\.\d*)?$/.test(cleaned)) {
    return BigInt(0);
  }

  const isNegative = cleaned.startsWith('-');
  const unsigned = cleaned.replace(/^[+-]/, '');
  const [intPartRaw = '0', fracPartRaw = ''] = unsigned.split('.');
  const intPart = intPartRaw || '0';

  const paddedFrac = (fracPartRaw + '0'.repeat(decimals + 1)).slice(
    0,
    decimals + 1
  );
  const mainFrac = paddedFrac.slice(0, decimals);
  const nextDigit = Number(paddedFrac.charAt(decimals) || '0');

  const scaleFactor = BigInt(10 ** decimals);
  let scaled =
    BigInt(intPart) * scaleFactor +
    (mainFrac ? BigInt(mainFrac) : BigInt(0));

  if (nextDigit >= 5) {
    scaled += BigInt(1);
  }

  return isNegative ? -scaled : scaled;
}

/**
 * Formats a scaled cents/paisa BigInt (2 decimals) into a string like "1,000.00" or "13,450.00"
 */
export function formatCentsBigInt(
  cents: bigint,
  includeDecimals = true
): string {
  const isNegative = cents < BigInt(0);
  const absCents = isNegative ? -cents : cents;
  const whole = absCents / CENTS_SCALE;
  const frac = absCents % CENTS_SCALE;

  if (!includeDecimals && (frac === BigInt(0) || absCents >= BigInt(1000))) {
    const roundedWhole = (absCents + BigInt(50)) / CENTS_SCALE;
    const roundedWithCommas = roundedWhole
      .toString()
      .replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return `${isNegative && roundedWhole > BigInt(0) ? '-' : ''}${roundedWithCommas}`;
  }

  const wholeWithCommas = whole
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',');

  const fracStr = frac.toString().padStart(2, '0');
  return `${isNegative ? '-' : ''}${wholeWithCommas}.${fracStr}`;
}

/**
 * Converts a scaled cents BigInt back to a exact 2-decimal JavaScript number for RPC payloads.
 */
export function centsBigIntToNumber(cents: bigint): number {
  const isNegative = cents < BigInt(0);
  const absCents = isNegative ? -cents : cents;
  const whole = absCents / CENTS_SCALE;
  const frac = absCents % CENTS_SCALE;
  const str = `${isNegative ? '-' : ''}${whole.toString()}.${frac
    .toString()
    .padStart(2, '0')}`;
  return Number(str);
}

/**
 * Helper alias to parse a money string or number to 2-decimal cents/paisa BigInt.
 */
export function parseMoneyToCents(
  value: string | number | null | undefined
): bigint {
  return parseDecimalToScaledBigInt(value, 2);
}

/**
 * Helper alias to convert a 2-decimal cents/paisa BigInt to a plain fixed 2-decimal string without commas.
 */
export function centsToFixedString(cents: bigint): string {
  return formatCentsBigInt(cents, true).replace(/,/g, '');
}

/**
 * Formats an active USDT -> NPR exchange rate as "1 USDT = Rs 134.50".
 */
export function formatExchangeRateLabel(
  rate: number | string | null | undefined
): string {
  const rateScaled4 = parseDecimalToScaledBigInt(
    rate ?? DEFAULT_USDT_NPR_RATE,
    4
  );
  // Convert 4-decimal rate to 2-decimal display cents with half-up rounding
  const rateCents = (rateScaled4 + BigInt(50)) / BigInt(100);
  return `1 USDT = Rs ${formatCentsBigInt(rateCents, true)}`;
}

/**
 * Converts a base USDT amount (in cents) to NPR (in paisa) using BigInt half-up rounding:
 * npr_paisa = round_half_up(usdt_cents * rate_scaled_4 / 10000)
 */
export function convertUsdtCentsToNprPaisa(
  usdtCents: bigint,
  rateScaled4: bigint
): bigint {
  if (rateScaled4 <= BigInt(0)) return usdtCents;
  const isNegative = usdtCents < BigInt(0);
  const absUsdt = isNegative ? -usdtCents : usdtCents;
  const numerator = absUsdt * rateScaled4 + RATE_SCALE / BigInt(2);
  const nprPaisa = numerator / RATE_SCALE;
  return isNegative ? -nprPaisa : nprPaisa;
}

/**
 * Converts an NPR amount (in paisa) to base USDT (in cents) using BigInt half-up rounding:
 * usdt_cents = round_half_up(npr_paisa * 10000 / rate_scaled_4)
 */
export function convertNprPaisaToUsdtCents(
  nprPaisa: bigint,
  rateScaled4: bigint
): bigint {
  if (rateScaled4 <= BigInt(0)) return nprPaisa;
  const isNegative = nprPaisa < BigInt(0);
  const absNpr = isNegative ? -nprPaisa : nprPaisa;
  const numerator = absNpr * RATE_SCALE + rateScaled4 / BigInt(2);
  const usdtCents = numerator / rateScaled4;
  return isNegative ? -usdtCents : usdtCents;
}

export interface FormatMoneyOptions {
  showPlusSign?: boolean;
  includeDecimals?: boolean;
  /**
   * Optional override when formatting a historical trade that has its own snapshot rate.
   */
  tradeDisplayCurrency?: CurrencyCode | string | null;
  tradeFxRateUsed?: number | string | null;
}

/**
 * Shared helper `formatMoney(baseAmount, currency, rate, options)`:
 * - `baseAmount`: amount in base units (USDT)
 * - `currency`: 'USDT' | 'NPR'
 * - `rate`: active USDT -> NPR rate (numeric(12,4))
 * - Returns formatted string:
 *   - USDT: "$1,000.00" (or "+$1,000.00" / "-$1,000.00")
 *   - NPR:  "Rs 13,450.00" (or "+Rs 13,450.00" / "-Rs 13,450.00")
 * - If `rate` is missing or invalid when `currency === 'NPR'`, safely falls back to `USDT` display.
 */
export function formatMoney(
  baseAmount: number | string | null | undefined,
  currency: CurrencyCode,
  rate: number | string | null | undefined,
  options?: FormatMoneyOptions
): string {
  const usdtCents = parseDecimalToScaledBigInt(baseAmount, 2);

  // Determine effective rate if viewing in NPR
  let effectiveRateInput = rate;
  if (
    currency === 'NPR' &&
    options?.tradeDisplayCurrency === 'NPR' &&
    options?.tradeFxRateUsed !== null &&
    options?.tradeFxRateUsed !== undefined &&
    Number(options.tradeFxRateUsed) > 0
  ) {
    effectiveRateInput = options.tradeFxRateUsed;
  }

  const rateScaled = parseDecimalToScaledBigInt(effectiveRateInput, 4);

  // Safety rule: if rate is missing or <= 0, fall back to USDT display, never guess a rate.
  const effectiveCurrency: CurrencyCode =
    currency === 'NPR' && rateScaled > BigInt(0) ? 'NPR' : 'USDT';

  const targetMinorUnits =
    effectiveCurrency === 'NPR'
      ? convertUsdtCentsToNprPaisa(usdtCents, rateScaled)
      : usdtCents;

  const isNegative = targetMinorUnits < BigInt(0);
  const isPositive = targetMinorUnits > BigInt(0);
  const absMinor = isNegative ? -targetMinorUnits : targetMinorUnits;

  const formattedNumber = formatCentsBigInt(
    absMinor,
    options?.includeDecimals ?? true
  );
  const symbol = CURRENCY_CONFIGS[effectiveCurrency].symbol; // '$' or 'Rs '

  const signPrefix = isNegative
    ? '-'
    : isPositive && options?.showPlusSign
      ? '+'
      : '';

  return `${signPrefix}${symbol}${formattedNumber}`;
}

export interface ToBaseResult {
  /** Base amount in USDT rounded to 2 decimal places */
  baseUsdt: number;
  /** Exact 2-decimal string in USDT e.g. "10.00" */
  baseUsdtString: string;
  /** Equivalent amount in display currency corresponding to the quantized baseUsdt */
  exactDisplayAmount: number;
  /** Formatted string of the quantized baseUsdt in NPR/USDT */
  exactDisplayFormatted: string;
  /** True if the user's typed NPR input did not divide cleanly into 2-decimal USDT */
  wasRounded: boolean;
}

/**
 * Shared helper `toBase(inputAmount, currency, rate)`:
 * Converts a user-entered amount in `currency` ('USDT' | 'NPR') into 2-decimal base `USDT`.
 * Uses BigInt fixed-point math only.
 * Also checks whether `inputAmount` in NPR rounds to a slightly different NPR value after
 * quantizing to 2-decimal USDT, so the UI can show the exact converted value before confirmation
 * and guarantee zero off-by-one-paisa discrepancies on round-trip.
 */
export function toBase(
  inputAmount: number | string | null | undefined,
  currency: CurrencyCode,
  rate: number | string | null | undefined
): ToBaseResult {
  const inputMinorUnits = parseDecimalToScaledBigInt(inputAmount, 2);
  const rateScaled = parseDecimalToScaledBigInt(rate, 4);

  if (currency === 'USDT' || rateScaled <= BigInt(0)) {
    const baseUsdt = centsBigIntToNumber(inputMinorUnits);
    const baseUsdtString = formatCentsBigInt(inputMinorUnits, true).replace(
      /,/g,
      ''
    );
    return {
      baseUsdt,
      baseUsdtString,
      exactDisplayAmount: baseUsdt,
      exactDisplayFormatted: formatMoney(baseUsdt, 'USDT', rate),
      wasRounded: false,
    };
  }

  // Convert NPR paisa -> quantized 2-decimal USDT cents
  const usdtCents = convertNprPaisaToUsdtCents(inputMinorUnits, rateScaled);
  // Round-trip quantized USDT cents -> NPR paisa
  const roundTripNprPaisa = convertUsdtCentsToNprPaisa(usdtCents, rateScaled);

  const baseUsdt = centsBigIntToNumber(usdtCents);
  const baseUsdtString = formatCentsBigInt(usdtCents, true).replace(/,/g, '');
  const exactDisplayAmount = centsBigIntToNumber(roundTripNprPaisa);

  return {
    baseUsdt,
    baseUsdtString,
    exactDisplayAmount,
    exactDisplayFormatted: formatMoney(baseUsdt, 'NPR', rate),
    wasRounded: roundTripNprPaisa !== inputMinorUnits,
  };
}

/**
 * Converts a base USDT amount to a raw number in the target currency (2 decimals)
 * for pre-filling input fields when switching currencies.
 */
export function fromBaseToInputString(
  baseUsdtAmount: number | string,
  currency: CurrencyCode,
  rate: number | string | null | undefined
): string {
  const usdtCents = parseDecimalToScaledBigInt(baseUsdtAmount, 2);
  const rateScaled = parseDecimalToScaledBigInt(rate, 4);
  if (currency === 'USDT' || rateScaled <= BigInt(0)) {
    return formatCentsBigInt(usdtCents, true).replace(/,/g, '');
  }
  const nprPaisa = convertUsdtCentsToNprPaisa(usdtCents, rateScaled);
  return formatCentsBigInt(nprPaisa, true).replace(/,/g, '');
}

export interface ConvertedLimits {
  minDisplay: number;
  maxDisplay: number;
  minDisplayFormatted: string;
  maxDisplayFormatted: string;
  minFormatted: string;
  maxFormatted: string;
  quickAmountsDisplay: number[];
}

/**
 * Computes sensible converted limits in the active currency while keeping all real limits in USDT.
 * Ensures NPR minimum is NEVER below the real USDT minimum (uses ceiling to whole integer NPR).
 */
export function getLimitsInCurrency(
  minUsdt: number,
  maxUsdt: number,
  quickUsdtPresets: readonly number[],
  currency: CurrencyCode,
  rate: number | string | null | undefined
): ConvertedLimits {
  const rateScaled = parseDecimalToScaledBigInt(rate, 4);
  if (currency === 'USDT' || rateScaled <= BigInt(0)) {
    const minFmt = formatMoney(minUsdt, 'USDT', rate);
    const maxFmt = formatMoney(maxUsdt, 'USDT', rate);
    return {
      minDisplay: minUsdt,
      maxDisplay: maxUsdt,
      minDisplayFormatted: minFmt,
      maxDisplayFormatted: maxFmt,
      minFormatted: minFmt,
      maxFormatted: maxFmt,
      quickAmountsDisplay: [...quickUsdtPresets],
    };
  }

  const minUsdtCents = parseDecimalToScaledBigInt(minUsdt, 2);
  const maxUsdtCents = parseDecimalToScaledBigInt(maxUsdt, 2);

  // Minimum NPR: ceiling so that toBase(minDisplay, 'NPR', rate).baseUsdt >= minUsdt
  let minNprPaisa = convertUsdtCentsToNprPaisa(minUsdtCents, rateScaled);
  while (convertNprPaisaToUsdtCents(minNprPaisa, rateScaled) < minUsdtCents) {
    minNprPaisa += BigInt(1);
  }
  // Round up to a clean whole rupee if fractional
  const remMin = minNprPaisa % CENTS_SCALE;
  if (remMin > BigInt(0)) {
    minNprPaisa += CENTS_SCALE - remMin;
  }

  // Maximum NPR: floor so that toBase(maxDisplay, 'NPR', rate).baseUsdt <= maxUsdt
  let maxNprPaisa = convertUsdtCentsToNprPaisa(maxUsdtCents, rateScaled);
  while (convertNprPaisaToUsdtCents(maxNprPaisa, rateScaled) > maxUsdtCents) {
    maxNprPaisa -= BigInt(1);
  }

  const minDisplay = centsBigIntToNumber(minNprPaisa);
  const maxDisplay = centsBigIntToNumber(maxNprPaisa);

  const quickAmountsDisplay = quickUsdtPresets.map((presetUsdt) => {
    const presetCents = parseDecimalToScaledBigInt(presetUsdt, 2);
    const nprPaisa = convertUsdtCentsToNprPaisa(presetCents, rateScaled);
    // Round preset to whole rupee for clean button labels, clamped within [minDisplay, maxDisplay]
    const wholeRupees = Number((nprPaisa + BigInt(50)) / CENTS_SCALE);
    return Math.min(maxDisplay, Math.max(minDisplay, wholeRupees));
  });

  const minFmt = `Rs ${formatCentsBigInt(minNprPaisa, true)}`;
  const maxFmt = `Rs ${formatCentsBigInt(maxNprPaisa, true)}`;

  return {
    minDisplay,
    maxDisplay,
    minDisplayFormatted: minFmt,
    maxDisplayFormatted: maxFmt,
    minFormatted: minFmt,
    maxFormatted: maxFmt,
    quickAmountsDisplay,
  };
}

/**
 * Calculates percentage change between two rates using BigInt scaled math (2 decimals).
 */
export function calculateRatePercentChange(
  oldRate: number | string | null | undefined,
  newRate: number | string | null | undefined
): {
  percentChange: number;
  absPercentChange: number;
  exceeds20Percent: boolean;
  exceedsTwentyPercent: boolean;
  formattedPercent: string;
} {
  const oldScaled = parseDecimalToScaledBigInt(oldRate, 4);
  const newScaled = parseDecimalToScaledBigInt(newRate, 4);
  if (oldScaled <= BigInt(0) || newScaled <= BigInt(0)) {
    return {
      percentChange: 0,
      absPercentChange: 0,
      exceeds20Percent: false,
      exceedsTwentyPercent: false,
      formattedPercent: '0.00%',
    };
  }

  const diff = newScaled - oldScaled;
  const absDiff = diff < BigInt(0) ? -diff : diff;
  // Scale by 100 * 10000 for 4 decimal places of percentage
  const pctScaled4 = (diff * BigInt(1000000)) / oldScaled;
  const absPctScaled4 = (absDiff * BigInt(1000000)) / oldScaled;

  const percentChange = Number((Number(pctScaled4) / 10000).toFixed(2));
  const absPercentChange = Number((Number(absPctScaled4) / 10000).toFixed(2));
  const exceeds20Percent = absPctScaled4 > BigInt(200000); // > 20.0000%
  const formattedPercent = `${
    percentChange >= 0 ? '+' : ''
  }${percentChange.toFixed(2)}%`;

  return {
    percentChange,
    absPercentChange,
    exceeds20Percent,
    exceedsTwentyPercent: exceeds20Percent,
    formattedPercent,
  };
}
