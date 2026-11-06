'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  createChart,
  ColorType,
  CrosshairMode,
  LineStyle,
  IChartApi,
  ISeriesApi,
  UTCTimestamp,
  IPriceLine,
  Time,
} from 'lightweight-charts';
import {
  Plus,
  ChevronDown,
  Pencil,
  BarChart2,
  Sliders,
  Minus,
  X,
  MoreHorizontal,
  Briefcase,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { isSupabaseConfigured, PriceTickRow } from '@/lib/supabase/types';
import {
  CANDLE_INTERVAL_SECONDS,
  TARGET_HISTORY_CANDLES,
  MAX_CANDLES_IN_MEMORY,
  RESYNC_WINDOW_SECONDS,
  CANDLE_EASING_FACTOR,
  SNAP_GAP_MULTIPLIER,
  MAX_FRAME_STEP_RATIO,
  ABNORMAL_RANGE_MEDIAN_MULTIPLIER,
  MEDIAN_RANGE_LOOKBACK_CANDLES,
} from '@/lib/chart-config';
import LoadingScreen from '@/components/LoadingScreen';
import { useCurrency } from '@/components/CurrencyProvider';
import { CurrencyCode } from '@/lib/currency';

export interface LiveTick {
  symbol: string;
  assetId?: string;
  price: number;
  prevPrice: number;
  direction: 'UP' | 'DOWN' | 'FLAT';
  timestamp: number;
}

export interface AssetOption {
  id: string;
  symbol: string;
  name: string;
  payoutPercent?: number;
  volatility?: number;
  isActive: boolean;
}

export interface ActiveTradeOverlay {
  id: string;
  direction: 'CALL' | 'PUT';
  amount: number;
  entryPrice: number;
  openedAt?: string;
  expiresAt: string;
  payoutPercent: number;
  displayCurrency?: CurrencyCode | null;
  fxRateUsed?: number | null;
}

export interface SettledTradeResultOverlay {
  id: string;
  symbol: string;
  direction: 'CALL' | 'PUT';
  amount: number;
  entryPrice: number;
  exitPrice: number;
  status: 'WON' | 'LOST' | 'DRAW';
  totalPayout: number;
  durationLabel: string;
  displayCurrency?: CurrencyCode | null;
  fxRateUsed?: number | null;
}

interface RenderedTradeOverlay extends ActiveTradeOverlay {
  y: number;
  entryX: number;
  endX: number;
  pillOffsetX: number;
}

interface PriceChartProps {
  symbol: string;
  assetId?: string;
  payoutPercent?: number;
  assets: AssetOption[];
  onSelectSymbol: (symbol: string) => void;
  onTick?: (tick: LiveTick) => void;
  openTrade?: ActiveTradeOverlay | null;
  openTrades?: ActiveTradeOverlay[];
  recentTradeResult?: SettledTradeResultOverlay | null;
  onDismissTradeResult?: () => void;
  remainingSeconds?: number;
  hoverDirection?: 'CALL' | 'PUT' | null;
  mobileTradesDrawerOpen?: boolean;
  onToggleMobileTradesDrawer?: () => void;
  totalTradesBadgeCount?: number;
}

export interface CandlePoint {
  time: UTCTimestamp;
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface RawTickInput {
  id?: number | string;
  price: number;
  timestampMs?: number;
  timestamp?: number | string;
  created_at?: string;
}

const EMPTY_OVERLAYS: ActiveTradeOverlay[] = [];

function getBasePriceForSymbol(symbol: string): number {
  if (symbol === 'BTC/USD') return 89420.5;
  if (symbol === 'ETH/USD') return 3185.25;
  if (symbol === 'EUR/USD') return 1.0842;
  return 2745.8;
}

/**
 * Default volatility defined as PERCENT PER 1-SECOND TICK:
 * - BTC/USD: 0.020 (% per 1s tick)
 * - ETH/USD: 0.025 (% per 1s tick)
 * - EUR/USD: 0.004 (% per 1s tick)
 * - GOLD:    0.010 (% per 1s tick)
 */
function getVolatilityPctForSymbol(symbol: string, overrideVol?: number): number {
  if (
    typeof overrideVol === 'number' &&
    Number.isFinite(overrideVol) &&
    overrideVol >= 0.001 &&
    overrideVol <= 0.2
  ) {
    return overrideVol;
  }
  if (symbol === 'BTC/USD') return 0.02;
  if (symbol === 'ETH/USD') return 0.025;
  if (symbol === 'EUR/USD') return 0.004;
  return 0.01; // GOLD
}

// Deterministic pseudo-random helper (0, 1) from a seed integer
function seededUnit(seed: number): number {
  const x = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return Math.max(1e-9, Math.min(1 - 1e-9, x - Math.floor(x)));
}

// Deterministic Box-Muller standard normal N(0, 1) from two seeds
function seededBoxMuller(seedA: number, seedB: number): number {
  const u1 = seededUnit(seedA);
  const u2 = seededUnit(seedB);
  const z = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
  return Math.max(-4.0, Math.min(4.0, z));
}

// Live Box-Muller standard normal N(0, 1) with zero drift
function randomBoxMuller(): number {
  const u1 = Math.max(1e-12, Math.min(1 - 1e-12, Math.random()));
  const u2 = Math.random();
  const z = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
  return Math.max(-4.0, Math.min(4.0, z));
}

function extractTickTimestampMs(tick: RawTickInput): number {
  if (typeof tick.timestampMs === 'number' && Number.isFinite(tick.timestampMs)) {
    return tick.timestampMs > 1e11 ? tick.timestampMs : tick.timestampMs * 1000;
  }
  if (typeof tick.timestamp === 'number' && Number.isFinite(tick.timestamp)) {
    return tick.timestamp > 1e11 ? tick.timestamp : tick.timestamp * 1000;
  }
  if (typeof tick.timestamp === 'string') {
    const parsed = new Date(tick.timestamp).getTime();
    if (Number.isFinite(parsed)) return parsed;
  }
  if (typeof tick.created_at === 'string') {
    const parsed = new Date(tick.created_at).getTime();
    if (Number.isFinite(parsed)) return parsed;
  }
  return Date.now();
}

/**
 * Shared OHLC aggregation function with clock alignment and gap filling.
 * - Aligns ticks to clock buckets: bucket = Math.floor(timestampSec / intervalSeconds) * intervalSeconds
 *   (so for 30s candles, buckets start at :00 and :30 seconds).
 * - Deduplicates ticks by timestamp.
 * - Gap filling: any missing window between buckets with no ticks becomes a flat candle at the previous close.
 * - Each bucket that contains real ticks builds its candle purely from the real ticks in that bucket
 *   (open = first tick of the bucket, high = max tick of bucket, low = min tick of bucket, close = last tick of bucket).
 * - Caps output to MAX_CANDLES_IN_MEMORY (500).
 */
export function buildCandles(
  ticks: RawTickInput[],
  intervalSeconds: number = CANDLE_INTERVAL_SECONDS
): CandlePoint[] {
  const safeInterval = Math.max(1, Math.floor(intervalSeconds));
  if (!ticks || ticks.length === 0) {
    return [];
  }

  const rawNormalized = ticks
    .map((t) => ({
      price: Number(t.price),
      tsMs: extractTickTimestampMs(t),
    }))
    .filter((t) => Number.isFinite(t.price) && t.price > 0 && Number.isFinite(t.tsMs))
    .sort((a, b) => a.tsMs - b.tsMs);

  if (rawNormalized.length === 0) {
    return [];
  }

  // Deduplicate by timestampMs
  const normalized: { price: number; tsMs: number }[] = [];
  let lastSeenTs = -1;
  for (let i = 0; i < rawNormalized.length; i++) {
    const item = rawNormalized[i];
    if (item.tsMs === lastSeenTs) {
      normalized[normalized.length - 1] = item;
    } else {
      normalized.push(item);
      lastSeenTs = item.tsMs;
    }
  }

  const candles: CandlePoint[] = [];

  for (let i = 0; i < normalized.length; i++) {
    const tick = normalized[i];
    const timestampSec = Math.floor(tick.tsMs / 1000);
    const bucketSec = (Math.floor(timestampSec / safeInterval) *
      safeInterval) as UTCTimestamp;

    const lastCandle = candles[candles.length - 1];
    if (!lastCandle) {
      candles.push({
        time: bucketSec,
        open: tick.price,
        high: tick.price,
        low: tick.price,
        close: tick.price,
      });
    } else if (lastCandle.time === bucketSec) {
      if (tick.price > lastCandle.high) lastCandle.high = tick.price;
      if (tick.price < lastCandle.low) lastCandle.low = tick.price;
      lastCandle.close = tick.price;
    } else if (bucketSec > lastCandle.time) {
      const prevClose = lastCandle.close;
      // Fill any missing 30s windows (that have no ticks) with flat candles at the previous close
      let fillBucket = (Number(lastCandle.time) + safeInterval) as UTCTimestamp;
      while (fillBucket < bucketSec) {
        candles.push({
          time: fillBucket,
          open: prevClose,
          high: prevClose,
          low: prevClose,
          close: prevClose,
        });
        fillBucket = (Number(fillBucket) + safeInterval) as UTCTimestamp;
      }

      // Open each new 30s candle at the previous candle's close so adjacent candles never have a vertical gap
      candles.push({
        time: bucketSec,
        open: prevClose,
        high: Math.max(prevClose, tick.price),
        low: Math.min(prevClose, tick.price),
        close: tick.price,
      });
    }
  }

  if (candles.length > MAX_CANDLES_IN_MEMORY) {
    return candles.slice(candles.length - MAX_CANDLES_IN_MEMORY);
  }

  return candles;
}

/**
 * Filters out any stale pre-reset / pre-migration tick regime so historical candles
 * are guaranteed to belong to the continuous price series ending at the latest real DB tick.
 */
function filterContinuousRealTicks(
  realTicks: { price: number; timestampMs: number }[],
  symbol: string,
  volatilityPctOverride?: number
): { price: number; timestampMs: number }[] {
  if (realTicks.length <= 1) return realTicks;
  const sorted = [...realTicks].sort((a, b) => a.timestampMs - b.timestampMs);
  const latestPrice = sorted[sorted.length - 1].price;
  const volPctPerSec = getVolatilityPctForSymbol(symbol, volatilityPctOverride);
  const typical30sMove =
    latestPrice * (volPctPerSec / 100) * Math.sqrt(CANDLE_INTERVAL_SECONDS);
  // Any single step jump larger than 15x a typical 30s candle move (or 0.8% of spot) is a regime reset cliff
  const maxStepCliff = Math.max(typical30sMove * 15, latestPrice * 0.008);

  for (let i = sorted.length - 1; i >= 1; i--) {
    const stepDiff = Math.abs(sorted[i].price - sorted[i - 1].price);
    if (stepDiff > maxStepCliff) {
      return sorted.slice(i);
    }
  }
  return sorted;
}

/**
 * Prepares ticks for 30s candle building:
 * - When real database ticks exist (`realTicks.length > 0`), uses ONLY the continuous real database ticks
 *   (no synthetic pre-ticks are mixed with real ticks).
 * - Only if `realTicks.length === 0` (empty database or offline preview) does it generate
 *   synthetic historical ticks anchored to `anchorPriceOverride ?? getBasePriceForSymbol(symbol)`.
 * - If the current 30s bucket has no real ticks yet, gap-fills up to the current 30s bucket
 *   using the previous candle's close.
 */
function ensureHistoryTicksFor30s(
  realTicks: { price: number; timestampMs: number }[],
  symbol: string,
  targetCandles = TARGET_HISTORY_CANDLES,
  volatilityPctOverride?: number,
  anchorPriceOverride?: number
): { price: number; timestampMs: number }[] {
  const intervalSeconds = CANDLE_INTERVAL_SECONDS;
  const decimals = symbol === 'EUR/USD' ? 4 : 2;
  const minUnit = symbol === 'EUR/USD' ? 0.0001 : 0.01;
  const basePrice =
    typeof anchorPriceOverride === 'number' &&
    Number.isFinite(anchorPriceOverride) &&
    anchorPriceOverride > 0
      ? anchorPriceOverride
      : getBasePriceForSymbol(symbol);
  const volPctPerSec = getVolatilityPctForSymbol(symbol, volatilityPctOverride);
  // Typical 30s candle range = price * (volatility / 100) * sqrt(30)
  const typicalRange =
    basePrice * (volPctPerSec / 100) * Math.sqrt(intervalSeconds);

  const sortedReal = [...realTicks].sort((a, b) => a.timestampMs - b.timestampMs);
  const nowMs = Date.now();
  const nowBucketSec =
    Math.floor(Math.floor(nowMs / 1000) / intervalSeconds) * intervalSeconds;

  let combined = sortedReal;

  // Only generate synthetic history when the database has 0 ticks
  if (sortedReal.length === 0) {
    const startBucketSec = nowBucketSec - (targetCandles - 1) * intervalSeconds;
    const preBuckets: number[] = [];
    for (let b = startBucketSec; b <= nowBucketSec; b += intervalSeconds) {
      preBuckets.push(b);
    }

    if (preBuckets.length > 0) {
      const bucketCloses = new Map<number, number>();
      let walkPrice = basePrice;
      let prevDelta = 0;
      const clampMin = basePrice * 0.97;
      const clampMax = basePrice * 1.03;

      for (let i = preBuckets.length - 1; i >= 0; i--) {
        const b = preBuckets[i];
        bucketCloses.set(b, Number(walkPrice.toFixed(decimals)));
        const z = seededBoxMuller(b + 11, b + 29);
        const burst = seededUnit(b + 71) < 0.08 ? 1.85 : 1.0;
        const freshDelta = z * typicalRange * 0.55 * burst;
        const delta = 0.85 * freshDelta + 0.15 * prevDelta;
        prevDelta = delta;
        const reversion = -0.02 * (walkPrice - basePrice);
        const rawWalk = walkPrice - delta + reversion;
        walkPrice = Math.min(
          clampMax,
          Math.max(clampMin, Math.max(minUnit * 10, Number(rawWalk.toFixed(decimals))))
        );
      }

      const syntheticPreTicks: { price: number; timestampMs: number }[] = [];
      let prevClose =
        bucketCloses.get(preBuckets[0]) ??
        Number(basePrice.toFixed(decimals));

      for (let i = 0; i < preBuckets.length; i++) {
        const b = preBuckets[i];
        const openPrice = Number(prevClose.toFixed(decimals));
        const closePrice =
          i === preBuckets.length - 1
            ? Number(basePrice.toFixed(decimals))
            : bucketCloses.get(b) ?? openPrice;

        const bodyMax = Math.max(openPrice, closePrice);
        const bodyMin = Math.min(openPrice, closePrice);
        const wickSpan = Math.max(minUnit * 2, typicalRange * 0.3);
        const highPrice = Number(
          (bodyMax + wickSpan * (0.2 + seededUnit(b + 31) * 0.5)).toFixed(decimals)
        );
        const lowPrice = Math.max(
          minUnit,
          Number(
            (bodyMin - wickSpan * (0.2 + seededUnit(b + 53) * 0.5)).toFixed(decimals)
          )
        );

        const baseMs = b * 1000;
        const stepMs = Math.max(200, Math.floor((intervalSeconds * 1000) / 5));
        syntheticPreTicks.push(
          { price: openPrice, timestampMs: baseMs + 10 },
          { price: highPrice, timestampMs: baseMs + stepMs },
          { price: lowPrice, timestampMs: baseMs + stepMs * 2 },
          { price: closePrice, timestampMs: baseMs + stepMs * 3 }
        );

        prevClose = closePrice;
      }

      combined = syntheticPreTicks;
    }
  }

  // If the current 30s clock bucket has no real ticks yet, add an anchor tick at the
  // previous candle's close so the current candle opens flat at the previous candle's close.
  if (combined.length > 0) {
    const lastTick = combined[combined.length - 1];
    const lastBucketSec =
      Math.floor(Math.floor(lastTick.timestampMs / 1000) / intervalSeconds) *
      intervalSeconds;
    if (lastBucketSec < nowBucketSec) {
      combined = [
        ...combined,
        { price: lastTick.price, timestampMs: nowBucketSec * 1000 + 10 },
      ];
    }
  }

  return combined;
}

function formatTimeAxisLabel(utcSeconds: number): string {
  const d = new Date(utcSeconds * 1000);
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  const ss = String(d.getUTCSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

function formatCountdownLabel(remainingSec: number): string {
  const safe = Math.max(0, Math.floor(remainingSec));
  const mm = String(Math.floor(safe / 60)).padStart(2, '0');
  const ss = String(safe % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}

export function PriceChart({
  symbol,
  assetId,
  payoutPercent = 85,
  assets,
  onSelectSymbol,
  onTick,
  openTrade,
  openTrades = EMPTY_OVERLAYS,
  recentTradeResult = null,
  onDismissTradeResult,
  remainingSeconds = 0,
  hoverDirection = null,
  mobileTradesDrawerOpen = false,
  onToggleMobileTradesDrawer,
  totalTradesBadgeCount = 0,
}: PriceChartProps) {
  const { currency, rate, formatMoney } = useCurrency();
  const chartContainerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const easedPriceLineRef = useRef<IPriceLine | null>(null);

  const currentCandleRef = useRef<CandlePoint | null>(null);
  const candlesRef = useRef<CandlePoint[]>([]);

  // ===========================================================================
  // TARGET PRICE (real server tick) vs DISPLAYED PRICE (visual easing only)
  // IMPORTANT: This animation is visual only. Trade entry prices, markers, and
  // settlement must keep using the real server tick price (targetPriceRef),
  // never the eased displayed price (displayedPriceRef).
  // ===========================================================================
  const targetPriceRef = useRef<number>(0);
  const displayedPriceRef = useRef<number>(0);
  const prevTickPriceRef = useRef<number>(0);
  const lastRealCloseRef = useRef<number>(0);

  // Real-tick tracking for the active 30s bucket (never derived from eased price)
  const trueBucketOpenRef = useRef<number>(0);
  const trueBucketHighRef = useRef<number>(0);
  const trueBucketLowRef = useRef<number>(0);
  const currentBucketTicksRef = useRef<number[]>([]);

  // Strict readiness & ordering gates:
  // Animation loop and live tick handler are blocked until history has loaded via setData
  // AND the latest real tick is known.
  const isHistoryReadyRef = useRef<boolean>(false);
  const hasRealTickRef = useRef<boolean>(false);
  const lastHistoryTickTsRef = useRef<number>(0);
  const lastProcessedTickTsRef = useRef<number>(0);
  const seenTickTimestampsRef = useRef<Set<number>>(new Set());

  const latestServerTickRef = useRef<{ price: number; timestampMs: number } | null>(
    null
  );

  // Deduplication set for incoming server ticks across reconnects
  const seenTickKeysRef = useRef<Set<string>>(new Set());
  const previewTicksRef = useRef<{ price: number; timestampMs: number }[]>([]);
  const resolvedAssetIdRef = useRef<string | undefined>(
    assetId && !assetId.startsWith('demo-') ? assetId : undefined
  );
  const loadedRealAssetIdRef = useRef<string | undefined>(undefined);
  const resolvedAnchorPriceRef = useRef<number | undefined>(undefined);

  const tradePriceLinesRef = useRef<IPriceLine[]>([]);
  const tradeOpenedAtMapRef = useRef<Map<string, number>>(new Map());
  const setDataCallCountRef = useRef<number>(0);
  const isTabHiddenRef = useRef<boolean>(false);
  const rafIdRef = useRef<number | null>(null);
  const historyRafIdRef = useRef<number | null>(null);
  const historyLoadIdRef = useRef<number>(0);
  const isChartAliveRef = useRef<boolean>(false);
  const disposedObjectsRef = useRef<WeakSet<object>>(new WeakSet());
  const onTickRef = useRef(onTick);
  const startAnimationLoopRef = useRef<() => void>(() => {});
  const stopAnimationLoopRef = useRef<() => void>(() => {});

  useEffect(() => {
    onTickRef.current = onTick;
  }, [onTick]);

  const [latestServerPrice, setLatestServerPrice] = useState<number>(0);
  const [priceLineY, setPriceLineY] = useState<number | null>(null);
  const lastPriceLineYRef = useRef<number | null>(null);
  const [tradeOverlayCoords, setTradeOverlayCoords] = useState<
    RenderedTradeOverlay[]
  >([]);
  const lastTradeCoordsKeyRef = useRef<string>('');
  const [nowMs, setNowMs] = useState<number>(0);
  const [rightScaleWidth, setRightScaleWidth] = useState<number>(62);
  const [timeScaleHeight, setTimeScaleHeight] = useState<number>(26);
  const [streamStatus, setStreamStatus] = useState<
    'connecting' | 'realtime' | 'preview'
  >('connecting');
  const [isChartLoading, setIsChartLoading] = useState<boolean>(true);
  const [utcTimeStr, setUtcTimeStr] = useState<string>('08:00:00');
  const [bullishPercent, setBullishPercent] = useState<number>(85);
  const [assetMenuOpen, setAssetMenuOpen] = useState<boolean>(false);
  const [pairInfoOpen, setPairInfoOpen] = useState<boolean>(false);
  const [mobileToolsOpen, setMobileToolsOpen] = useState<boolean>(false);
  const [candleCountdown, setCandleCountdown] = useState<number>(
    CANDLE_INTERVAL_SECONDS
  );

  const isFourDecimals = symbol === 'EUR/USD';
  const decimals = isFourDecimals ? 4 : 2;
  const minMove = isFourDecimals ? 0.0001 : 0.01;
  const initialSymbolRef = useRef(symbol);
  const initialDecimalsRef = useRef(decimals);
  const initialMinMoveRef = useRef(minMove);

  const activeAssetVolatility = assets.find((a) => a.symbol === symbol)?.volatility;
  const activeAssetVolatilityRef = useRef<number | undefined>(activeAssetVolatility);
  useEffect(() => {
    activeAssetVolatilityRef.current = activeAssetVolatility;
  }, [activeAssetVolatility]);

  // Clean up any legacy timeframe localStorage key from previous versions
  useEffect(() => {
    try {
      window.localStorage.removeItem('quotex_chart_timeframe_sec');
    } catch {
      // Ignore storage errors in restricted iframes
    }
  }, []);

  // Expose verification helpers on window for manual inspection of setData count, candles, and prices
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const win = window as unknown as Record<string, unknown>;
      win.__buildCandles = buildCandles;
      win.__getChartCandles = () => candlesRef.current;
      win.__getCurrentPrice = () => targetPriceRef.current;
      win.__getDisplayedPrice = () => displayedPriceRef.current;
      win.__getSetDataCount = () => setDataCallCountRef.current;
    }
  }, []);

  /**
   * 5x Median Range Safety Guard:
   * If a candle's range (high - low) exceeds 5x the median range of the last 20 completed candles,
   * logs a console.warn with the exact values that built it (displayed, target, prevTick, bucketTicks)
   * and clamps the candle to the real tick high/low of the current bucket.
   */
  const guardAndClampCandleRange = useCallback(
    (candle: CandlePoint, contextLabel: string): CandlePoint => {
      const allCandles = candlesRef.current;
      const completedCount = Math.max(0, allCandles.length - 1);
      const startIdx = Math.max(0, completedCount - MEDIAN_RANGE_LOOKBACK_CANDLES);
      const lookback = allCandles.slice(startIdx, completedCount);

      if (lookback.length >= 5) {
        const volPct = getVolatilityPctForSymbol(
          symbol,
          activeAssetVolatilityRef.current
        );
        const refPrice =
          targetPriceRef.current || candle.close || getBasePriceForSymbol(symbol);
        const normalTickMove = Math.max(minMove, refPrice * (volPct / 100));

        const ranges = lookback
          .map((c) => Math.max(0, c.high - c.low))
          .filter((r) => Number.isFinite(r))
          .sort((a, b) => a - b);

        if (ranges.length > 0) {
          const mid = Math.floor(ranges.length / 2);
          const rawMedian =
            ranges.length % 2 === 0
              ? (ranges[mid - 1] + ranges[mid]) / 2
              : ranges[mid];
          // Floor median at 2x normal 1s tick move so flat gap-filled candles do not trigger false alarms
          const effectiveMedian = Math.max(rawMedian, normalTickMove * 2);
          const candleRange = candle.high - candle.low;

          if (
            effectiveMedian > 0 &&
            candleRange > ABNORMAL_RANGE_MEDIAN_MULTIPLIER * effectiveMedian
          ) {
            const bucketTicks = currentBucketTicksRef.current;
            const realTickHigh =
              bucketTicks.length > 0
                ? Math.max(...bucketTicks)
                : trueBucketHighRef.current || targetPriceRef.current || candle.close;
            const realTickLow =
              bucketTicks.length > 0
                ? Math.min(...bucketTicks)
                : trueBucketLowRef.current || targetPriceRef.current || candle.close;
            const realTickOpen =
              bucketTicks.length > 0 ? bucketTicks[0] : candle.open;

            console.warn(
              `[PriceChart Safety Guard] Candle range (${candleRange.toFixed(
                decimals
              )}) exceeded ${ABNORMAL_RANGE_MEDIAN_MULTIPLIER}x median range (${effectiveMedian.toFixed(
                decimals
              )}) of last ${lookback.length} candles [${contextLabel}]`,
              {
                symbol,
                candleTime: candle.time,
                candle: { ...candle },
                candleRange,
                medianRangeLast20: effectiveMedian,
                displayedPrice: displayedPriceRef.current,
                targetPrice: targetPriceRef.current,
                prevTickPrice: prevTickPriceRef.current,
                trueBucketOpen: trueBucketOpenRef.current,
                trueBucketHigh: trueBucketHighRef.current,
                trueBucketLow: trueBucketLowRef.current,
                bucketTicks: [...bucketTicks],
              }
            );

            const clampedClose = Math.min(
              realTickHigh,
              Math.max(realTickLow, candle.close)
            );
            const clampedOpen = Math.min(
              realTickHigh,
              Math.max(realTickLow, realTickOpen)
            );
            return {
              time: candle.time,
              open: clampedOpen,
              high: Math.max(clampedOpen, clampedClose, realTickHigh),
              low: Math.min(clampedOpen, clampedClose, realTickLow),
              close: clampedClose,
            };
          }
        }
      }
      return candle;
    },
    [symbol, decimals, minMove]
  );

  const syncPriceLineCoordinate = useCallback((priceOverride?: number) => {
    if (!isChartAliveRef.current) return;
    const series = seriesRef.current;
    const chart = chartRef.current;
    const price = priceOverride ?? displayedPriceRef.current ?? targetPriceRef.current;
    if (
      !series ||
      !chart ||
      !price ||
      disposedObjectsRef.current.has(series) ||
      disposedObjectsRef.current.has(chart)
    ) {
      return;
    }

    try {
      const coord = series.priceToCoordinate(price);
      if (coord !== null && Number.isFinite(coord)) {
        const roundedY = Math.round(coord);
        if (lastPriceLineYRef.current !== roundedY) {
          lastPriceLineYRef.current = roundedY;
          setPriceLineY(roundedY);
        }
      }
      const rWidth = chart.priceScale('right').width();
      if (rWidth > 0) {
        setRightScaleWidth((prev) => {
          const next = Math.round(rWidth);
          return prev === next ? prev : next;
        });
      }
      const tHeight = chart.timeScale().height();
      if (tHeight > 0) {
        setTimeScaleHeight((prev) => {
          const next = Math.round(tHeight);
          return prev === next ? prev : next;
        });
      }
    } catch {
      return;
    }
    syncTradeMarkersAndLinesRef.current();
  }, []);

  // Update UTC clock and 30s candle countdown every second
  useEffect(() => {
    const updateClock = () => {
      const now = new Date();
      setNowMs(now.getTime());
      const hh = String(now.getUTCHours()).padStart(2, '0');
      const mm = String(now.getUTCMinutes()).padStart(2, '0');
      const ss = String(now.getUTCSeconds()).padStart(2, '0');
      setUtcTimeStr(`${hh}:${mm}:${ss}`);

      const nowSec = Math.floor(now.getTime() / 1000);
      setCandleCountdown(
        CANDLE_INTERVAL_SECONDS - (nowSec % CANDLE_INTERVAL_SECONDS)
      );
      if (isChartAliveRef.current) {
        syncTradeMarkersAndLinesRef.current();
      }
    };
    updateClock();
    const timer = setInterval(updateClock, 1000);
    return () => clearInterval(timer);
  }, []);

  // Initialize Lightweight-Charts instance ONCE on mount with 30s HH:mm:ss time axis
  useEffect(() => {
    const container = chartContainerRef.current;
    if (!container) return;

    const initialWidth = Math.max(container.clientWidth, 320);
    const initialHeight = Math.max(container.clientHeight, 260);

    const chart = createChart(container, {
      width: initialWidth,
      height: initialHeight,
      layout: {
        background: { type: ColorType.Solid, color: '#171a23' },
        textColor: '#c0c7d8',
        fontSize: 11,
        fontFamily: 'var(--font-mono), monospace',
        attributionLogo: false,
      },
      localization: {
        timeFormatter: (time: Time) => formatTimeAxisLabel(Number(time)),
      },
      grid: {
        vertLines: { color: '#212634', style: LineStyle.Solid },
        horzLines: { color: '#212634', style: LineStyle.Solid },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: {
          color: '#4e566d',
          width: 1,
          style: LineStyle.Dashed,
          labelBackgroundColor: '#252a3a',
        },
        horzLine: {
          color: '#3898ff',
          width: 1,
          style: LineStyle.Dashed,
          labelBackgroundColor: '#3898ff',
        },
      },
      rightPriceScale: {
        borderColor: '#262b38',
        scaleMargins: {
          top: 0.12,
          bottom: 0.12,
        },
      },
      timeScale: {
        borderColor: '#262b38',
        timeVisible: true,
        secondsVisible: true,
        rightOffset: 15,
        barSpacing: 20,
        minBarSpacing: 8,
        tickMarkFormatter: (time: Time) => formatTimeAxisLabel(Number(time)),
      },
      handleScroll: true,
      handleScale: true,
    });

    const candlestickSeries = chart.addCandlestickSeries({
      upColor: '#22ab68',
      downColor: '#e34c3b',
      borderVisible: false,
      wickUpColor: '#22ab68',
      wickDownColor: '#e34c3b',
      priceLineVisible: false,
      lastValueVisible: false,
      priceFormat: {
        type: 'price',
        precision: initialDecimalsRef.current,
        minMove: initialMinMoveRef.current,
      },
    });

    // Dedicated horizontal price line & right-axis label that glides with displayedPrice.
    // Hidden initially until real history & server tick are loaded.
    const easedPriceLine = candlestickSeries.createPriceLine({
      price: getBasePriceForSymbol(initialSymbolRef.current),
      color: '#3898ff',
      lineWidth: 1,
      lineStyle: LineStyle.Dashed,
      axisLabelVisible: false,
      lineVisible: false,
      title: '',
    });

    isChartAliveRef.current = true;
    chartRef.current = chart;
    seriesRef.current = candlestickSeries;
    easedPriceLineRef.current = easedPriceLine;

    let isInstanceDisposed = false;
    let hadZeroSize =
      container.clientWidth === 0 || container.clientHeight === 0;

    const handleVisibleRangeChange = () => {
      if (isInstanceDisposed || !isChartAliveRef.current) return;
      syncPriceLineCoordinate();
    };
    chart
      .timeScale()
      .subscribeVisibleLogicalRangeChange(handleVisibleRangeChange);

    const syncDimensions = () => {
      if (
        isInstanceDisposed ||
        !isChartAliveRef.current ||
        !chartRef.current ||
        !chartContainerRef.current ||
        disposedObjectsRef.current.has(chartRef.current)
      ) {
        return;
      }
      const rect = chartContainerRef.current.getBoundingClientRect();
      const width = Math.floor(
        rect.width || chartContainerRef.current.clientWidth
      );
      const height = Math.floor(
        rect.height || chartContainerRef.current.clientHeight
      );
      if (width > 0 && height > 0) {
        try {
          chartRef.current.applyOptions({ width, height });
          if (hadZeroSize) {
            hadZeroSize = false;
            chartRef.current.timeScale().scrollToRealTime();
          }
        } catch {
          return;
        }
        syncPriceLineCoordinate();
      } else {
        hadZeroSize = true;
      }
    };

    const resizeObserver = new ResizeObserver(() => {
      syncDimensions();
    });

    resizeObserver.observe(container);
    window.addEventListener('resize', syncDimensions);
    const initDimensionFrame = requestAnimationFrame(syncDimensions);

    return () => {
      isInstanceDisposed = true;
      isChartAliveRef.current = false;
      isHistoryReadyRef.current = false;
      hasRealTickRef.current = false;
      disposedObjectsRef.current.add(chart);
      disposedObjectsRef.current.add(candlestickSeries);
      disposedObjectsRef.current.add(easedPriceLine);

      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
      if (historyRafIdRef.current !== null) {
        cancelAnimationFrame(historyRafIdRef.current);
        historyRafIdRef.current = null;
      }
      cancelAnimationFrame(initDimensionFrame);
      window.removeEventListener('resize', syncDimensions);
      resizeObserver.disconnect();

      chartRef.current = null;
      seriesRef.current = null;
      easedPriceLineRef.current = null;
      currentCandleRef.current = null;
      candlesRef.current = [];
      tradePriceLinesRef.current = [];

      try {
        chart
          .timeScale()
          .unsubscribeVisibleLogicalRangeChange(handleVisibleRangeChange);
      } catch {
        // Ignore if already unsubscribed
      }
      try {
        chart.remove();
      } catch {
        // Ignore if already removed
      }
    };
  }, [syncPriceLineCoordinate]);

  // Update series price format without destroying/recreating the chart when symbol decimals change
  useEffect(() => {
    if (!isChartAliveRef.current) return;
    const series = seriesRef.current;
    if (!series || disposedObjectsRef.current.has(series)) return;
    try {
      series.applyOptions({
        priceFormat: {
          type: 'price',
          precision: decimals,
          minMove,
        },
      });
    } catch {
      // Ignore if series is disposed
    }
  }, [decimals, minMove]);

  // Immediately sync coordinate whenever hoverDirection changes
  useEffect(() => {
    if (hoverDirection) {
      syncPriceLineCoordinate();
    }
  }, [hoverDirection, syncPriceLineCoordinate]);

  // Compute exact pixel coordinates for Quotex-style open trade entry lines, dots, and pills.
  // IMPORTANT: Trade entry prices ALWAYS use the true server entryPrice (t.entryPrice),
  // never the eased displayed price.
  const syncTradeMarkersAndLines = useCallback(() => {
    if (!isChartAliveRef.current) return;
    const series = seriesRef.current;
    const chart = chartRef.current;
    if (
      !series ||
      !chart ||
      disposedObjectsRef.current.has(series) ||
      disposedObjectsRef.current.has(chart)
    ) {
      return;
    }

    // Ensure no legacy full-width price lines remain
    if (tradePriceLinesRef.current.length > 0) {
      for (const line of tradePriceLinesRef.current) {
        try {
          series.removePriceLine(line);
        } catch {
          // Ignore if already removed
        }
      }
      tradePriceLinesRef.current = [];
    }

    const rawCombined =
      openTrades.length > 0
        ? openTrades
        : openTrade
          ? [openTrade]
          : [];

    // Immediately exclude any trade whose expiry timestamp has reached 00:00
    const nowTimestamp = Date.now();
    const combined = rawCombined.filter(
      (t) => new Date(t.expiresAt).getTime() > nowTimestamp
    );

    if (combined.length === 0) {
      if (lastTradeCoordsKeyRef.current !== '') {
        lastTradeCoordsKeyRef.current = '';
        setTradeOverlayCoords([]);
      }
      return;
    }

    const container = chartContainerRef.current;
    const chartWidth = container?.clientWidth || 800;
    const chartHeight = container?.clientHeight || 500;
    let rScaleW = 62;
    let tScaleH = 26;
    try {
      rScaleW = chart.priceScale('right').width() || 62;
      tScaleH = chart.timeScale().height() || 26;
    } catch {
      return;
    }
    const plotWidth = Math.max(220, chartWidth - rScaleW);
    const plotHeight = Math.max(120, chartHeight - tScaleH);

    const nextOverlays: RenderedTradeOverlay[] = [];

    for (const t of combined) {
      let rawY: number | null = null;
      try {
        rawY = series.priceToCoordinate(t.entryPrice);
      } catch {
        return;
      }
      if (rawY === null || !Number.isFinite(rawY)) continue;

      let y = Math.max(18, Math.min(plotHeight - 14, Math.round(rawY)));

      let openedMs = t.openedAt ? new Date(t.openedAt).getTime() : NaN;
      if (!Number.isFinite(openedMs)) {
        const cached = tradeOpenedAtMapRef.current.get(t.id);
        if (cached !== undefined) {
          openedMs = cached;
        } else {
          const expMs = new Date(t.expiresAt).getTime();
          const curMs = Date.now();
          const remSec = Math.max(0, Math.round((expMs - curMs) / 1000));
          const stdDurations = [30, 60, 120, 300];
          const matchedDuration =
            stdDurations.find((d) => d >= remSec) ?? 60;
          openedMs = expMs - matchedDuration * 1000;
          tradeOpenedAtMapRef.current.set(t.id, openedMs);
        }
      } else {
        tradeOpenedAtMapRef.current.set(t.id, openedMs);
      }

      const openedSec = Math.floor(openedMs / 1000);
      const tradeBucketSec = (Math.floor(openedSec / CANDLE_INTERVAL_SECONDS) *
        CANDLE_INTERVAL_SECONDS) as UTCTimestamp;

      let rawX: number | null = null;
      try {
        rawX = chart.timeScale().timeToCoordinate(tradeBucketSec);

        if (rawX === null && candlesRef.current.length > 0) {
          const lastCandle = candlesRef.current[candlesRef.current.length - 1];
          const lastCandleX = chart.timeScale().timeToCoordinate(lastCandle.time);
          const barSpacing = chart.timeScale().options().barSpacing || 20;
          if (lastCandleX !== null) {
            const bucketDiff =
              (Number(tradeBucketSec) - Number(lastCandle.time)) /
              CANDLE_INTERVAL_SECONDS;
            rawX = lastCandleX + bucketDiff * barSpacing;
          }
        }
      } catch {
        return;
      }

      if (rawX === null || !Number.isFinite(rawX)) {
        rawX = Math.round(plotWidth * 0.68);
      }

      const entryX = Math.max(105, Math.min(plotWidth - 95, Math.round(rawX)));
      const endX = Math.min(plotWidth - 8, entryX + 108);

      // Stagger pills horizontally (and slightly vertically if identical Y) when multiple trades are close in price
      let pillOffsetX = 0;
      for (const prev of nextOverlays) {
        if (Math.abs(y - prev.y) < 4) {
          y = Math.min(plotHeight - 14, prev.y + 6);
        }
        if (
          Math.abs(y - prev.y) < 22 &&
          Math.abs(entryX - pillOffsetX - (prev.entryX - prev.pillOffsetX)) < 94
        ) {
          pillOffsetX = Math.min(
            Math.max(0, entryX - 96),
            (prev.pillOffsetX || 0) + 94
          );
        }
      }

      nextOverlays.push({
        ...t,
        y,
        entryX,
        endX,
        pillOffsetX,
      });
    }

    const coordsKey = nextOverlays
      .map(
        (c) =>
          `${c.id}:${c.y}:${c.entryX}:${c.endX}:${c.pillOffsetX}:${c.amount}:${c.direction}:${c.displayCurrency ?? ''}:${c.fxRateUsed ?? ''}`
      )
      .join('|');

    if (coordsKey !== lastTradeCoordsKeyRef.current) {
      lastTradeCoordsKeyRef.current = coordsKey;
      setTradeOverlayCoords(nextOverlays);
    }
  }, [openTrades, openTrade]);

  const syncTradeMarkersAndLinesRef = useRef(syncTradeMarkersAndLines);
  useEffect(() => {
    syncTradeMarkersAndLinesRef.current = syncTradeMarkersAndLines;
  }, [syncTradeMarkersAndLines]);

  useEffect(() => {
    syncTradeMarkersAndLines();
  }, [syncTradeMarkersAndLines, remainingSeconds]);

  // ===========================================================================
  // INCOMING SERVER TICK HANDLER
  // Ordering & Safety Rules:
  // 1. Ignore any tick that arrives before initial history (`setData`) is ready.
  // 2. Drop any tick older than or equal to the last history tick (`lastHistoryTickTsRef`).
  // 3. Dedupe by timestamp (`lastProcessedTickTsRef`, `seenTickTimestampsRef`) and `tickId`.
  // 4. If the gap between `displayedPrice` and `targetPrice` exceeds 3x the asset's
  //    normal per-tick move, SNAP `displayedPrice` to `targetPrice` immediately.
  // 5. Report the TRUE server tick price (never the eased price) to `TradingTerminal`.
  // ===========================================================================
  const handleIncomingServerTick = useCallback(
    (priceNum: number, timestampMs: number, tickId?: number | string) => {
      if (!Number.isFinite(priceNum) || priceNum <= 0) return;
      if (!Number.isFinite(timestampMs) || timestampMs <= 0) return;

      // Rule 4: Ignore ticks that arrive before history is ready
      if (!isHistoryReadyRef.current) {
        return;
      }

      // Rule 4: Drop any live tick older than (or equal to) the last history tick
      if (timestampMs <= lastHistoryTickTsRef.current) {
        return;
      }

      // Rule 4: Drop out-of-order ticks and dedupe by timestamp
      if (
        timestampMs <= lastProcessedTickTsRef.current ||
        seenTickTimestampsRef.current.has(timestampMs)
      ) {
        return;
      }

      // Deduplicate by tickId or timestamp+price key
      const dedupeKey =
        tickId !== undefined
          ? `id:${tickId}`
          : `ts:${timestampMs}:${priceNum.toFixed(decimals)}`;
      if (seenTickKeysRef.current.has(dedupeKey)) {
        return;
      }

      seenTickKeysRef.current.add(dedupeKey);
      if (seenTickKeysRef.current.size > 2000) {
        const firstKey = seenTickKeysRef.current.values().next().value;
        if (firstKey) seenTickKeysRef.current.delete(firstKey);
      }

      seenTickTimestampsRef.current.add(timestampMs);
      if (seenTickTimestampsRef.current.size > 2000) {
        const firstTs = seenTickTimestampsRef.current.values().next().value;
        if (firstTs !== undefined) seenTickTimestampsRef.current.delete(firstTs);
      }
      lastProcessedTickTsRef.current = timestampMs;

      const roundedServerPrice = Number(priceNum.toFixed(decimals));
      const prevServerPrice =
        targetPriceRef.current > 0 ? targetPriceRef.current : roundedServerPrice;
      const direction: 'UP' | 'DOWN' | 'FLAT' =
        roundedServerPrice > prevServerPrice
          ? 'UP'
          : roundedServerPrice < prevServerPrice
            ? 'DOWN'
            : 'FLAT';

      // Store previous real server tick and update targetPrice
      prevTickPriceRef.current = prevServerPrice;
      targetPriceRef.current = roundedServerPrice;
      lastRealCloseRef.current = roundedServerPrice;
      hasRealTickRef.current = true;

      const volPct = getVolatilityPctForSymbol(
        symbol,
        activeAssetVolatilityRef.current
      );
      const normalPerTickMove = Math.max(
        minMove,
        roundedServerPrice * (volPct / 100)
      );

      // Rule 3: If displayedPrice is unset or the gap between displayedPrice and targetPrice
      // is larger than 3x the asset's normal per-tick move, SNAP immediately with no animation.
      if (
        displayedPriceRef.current <= 0 ||
        Math.abs(roundedServerPrice - displayedPriceRef.current) >
          SNAP_GAP_MULTIPLIER * normalPerTickMove
      ) {
        displayedPriceRef.current = roundedServerPrice;
        prevTickPriceRef.current = roundedServerPrice;
      }

      const curBucketSec = (Math.floor(
        Math.floor(timestampMs / 1000) / CANDLE_INTERVAL_SECONDS
      ) * CANDLE_INTERVAL_SECONDS) as UTCTimestamp;

      const activeCandle = currentCandleRef.current;
      const series = seriesRef.current;

      if (activeCandle && Number(activeCandle.time) === Number(curBucketSec)) {
        // Keep activeCandle.open anchored to the previous candle's close (trueBucketOpenRef)
        // so there is never a vertical gap when the first tick of a bucket arrives.
        const openAnchor =
          trueBucketOpenRef.current > 0
            ? trueBucketOpenRef.current
            : activeCandle.open || roundedServerPrice;
        trueBucketOpenRef.current = openAnchor;
        trueBucketHighRef.current = Math.max(
          openAnchor,
          trueBucketHighRef.current || openAnchor,
          roundedServerPrice
        );
        trueBucketLowRef.current = Math.min(
          openAnchor,
          trueBucketLowRef.current > 0 ? trueBucketLowRef.current : openAnchor,
          roundedServerPrice
        );
        currentBucketTicksRef.current.push(roundedServerPrice);
      } else if (
        activeCandle &&
        Number(curBucketSec) > Number(activeCandle.time) &&
        series &&
        !disposedObjectsRef.current.has(series)
      ) {
        // A new 30s bucket has started with this real server tick!
        // 1. Finalize the previous candle using its real ticks (never eased price)
        const prevRealClose = prevServerPrice;
        const finalizedPrev: CandlePoint = guardAndClampCandleRange(
          {
            time: activeCandle.time,
            open: activeCandle.open,
            high: Math.max(
              activeCandle.open,
              trueBucketHighRef.current || prevRealClose,
              prevRealClose
            ),
            low: Math.min(
              activeCandle.open,
              trueBucketLowRef.current || prevRealClose,
              prevRealClose
            ),
            close: prevRealClose,
          },
          'bucket-rollover-on-tick'
        );

        if (candlesRef.current.length > 0) {
          candlesRef.current[candlesRef.current.length - 1] = finalizedPrev;
        }
        try {
          series.update(finalizedPrev);
        } catch {
          // Ignore if disposed
        }

        // 2. Gap-fill any intermediate empty 30s buckets at prevRealClose
        let fillBucket = (Number(activeCandle.time) +
          CANDLE_INTERVAL_SECONDS) as UTCTimestamp;
        while (fillBucket < curBucketSec) {
          const flatCandle: CandlePoint = {
            time: fillBucket,
            open: prevRealClose,
            high: prevRealClose,
            low: prevRealClose,
            close: prevRealClose,
          };
          candlesRef.current.push(flatCandle);
          try {
            series.update(flatCandle);
          } catch {
            // Ignore if disposed
          }
          fillBucket = (Number(fillBucket) +
            CANDLE_INTERVAL_SECONDS) as UTCTimestamp;
        }

        // 3. Open the new 30s bucket candle at the previous candle's close (`prevRealClose`)
        //    so adjacent candles connect seamlessly with zero vertical gap.
        const newOpen = prevRealClose;
        const newHigh = Math.max(newOpen, roundedServerPrice);
        const newLow = Math.min(newOpen, roundedServerPrice);

        trueBucketOpenRef.current = newOpen;
        trueBucketHighRef.current = newHigh;
        trueBucketLowRef.current = newLow;
        currentBucketTicksRef.current = [newOpen, roundedServerPrice];
        displayedPriceRef.current = roundedServerPrice;
        prevTickPriceRef.current = roundedServerPrice;

        const newCandle: CandlePoint = guardAndClampCandleRange(
          {
            time: curBucketSec,
            open: newOpen,
            high: newHigh,
            low: newLow,
            close: roundedServerPrice,
          },
          'new-bucket-on-tick'
        );
        currentCandleRef.current = newCandle;
        candlesRef.current.push(newCandle);
        if (candlesRef.current.length > MAX_CANDLES_IN_MEMORY) {
          candlesRef.current.shift();
        }
        try {
          series.update(newCandle);
          if (
            easedPriceLineRef.current &&
            !disposedObjectsRef.current.has(easedPriceLineRef.current)
          ) {
            easedPriceLineRef.current.applyOptions({
              price: roundedServerPrice,
              axisLabelVisible: true,
              lineVisible: true,
            });
          }
        } catch {
          // Ignore if disposed
        }
        syncPriceLineCoordinate(roundedServerPrice);
      }

      latestServerTickRef.current = {
        price: roundedServerPrice,
        timestampMs,
      };
      setLatestServerPrice(roundedServerPrice);

      // Report the TRUE server tick price (never the eased displayed price)
      // to parent TradingTerminal for trade entry / header quotes.
      onTickRef.current?.({
        symbol,
        assetId: resolvedAssetIdRef.current ?? assetId,
        price: roundedServerPrice,
        prevPrice: prevServerPrice,
        direction,
        timestamp: timestampMs,
      });

      setBullishPercent((prev) => {
        const delta = direction === 'UP' ? 1 : direction === 'DOWN' ? -1 : 0;
        return Math.min(96, Math.max(18, prev + delta));
      });
    },
    [symbol, assetId, decimals, minMove, guardAndClampCandleRange, syncPriceLineCoordinate]
  );

  // ===========================================================================
  // INITIAL HISTORY LOAD (~100 candles = ~50 minutes of 30s candles)
  // - Blocks animation loop until history is applied via series.setData(candles)
  //   AND displayedPrice = targetPrice = latestRealServerPrice is set BEFORE the first frame.
  // - Builds the current 30s candle strictly from real ticks in the current 30s bucket
  //   (open = first tick of the bucket, or previous candle's close if none yet).
  // ===========================================================================
  const loadInitialHistory = useCallback(async () => {
    const reqId = ++historyLoadIdRef.current;

    // Stop animation loop and block live ticks until history + real tick are initialized
    isHistoryReadyRef.current = false;
    hasRealTickRef.current = false;
    setIsChartLoading(true);
    stopAnimationLoopRef.current();

    const windowSeconds =
      (TARGET_HISTORY_CANDLES + 4) * CANDLE_INTERVAL_SECONDS;
    const sinceIso = new Date(
      Date.now() - windowSeconds * 1000
    ).toISOString();

    const applyCandlesToSeries = (
      candles: CandlePoint[],
      realTicksUsed: { price: number; timestampMs: number }[]
    ) => {
      if (reqId !== historyLoadIdRef.current || !isChartAliveRef.current) return;
      const series = seriesRef.current;
      const chart = chartRef.current;
      if (
        !series ||
        !chart ||
        disposedObjectsRef.current.has(series) ||
        disposedObjectsRef.current.has(chart)
      ) {
        return;
      }

      if (candles.length === 0) return;

      // Determine the current 30s bucket's real ticks and ensure its open price matches
      // the previous candle's close so adjacent candles never have a vertical gap.
      const last = candles[candles.length - 1];
      const lastBucketSec = Number(last.time);
      const bucketRealTicks = realTicksUsed.filter(
        (t) =>
          Math.floor(Math.floor(t.timestampMs / 1000) / CANDLE_INTERVAL_SECONDS) *
            CANDLE_INTERVAL_SECONDS ===
          lastBucketSec
      );

      const prevClose =
        candles.length >= 2
          ? candles[candles.length - 2].close
          : bucketRealTicks[0]?.price ?? last.open;

      if (bucketRealTicks.length > 0) {
        const openPrice = prevClose;
        const closePrice = bucketRealTicks[bucketRealTicks.length - 1].price;
        let highPrice = Math.max(openPrice, closePrice);
        let lowPrice = Math.min(openPrice, closePrice);
        for (const bt of bucketRealTicks) {
          if (bt.price > highPrice) highPrice = bt.price;
          if (bt.price < lowPrice) lowPrice = bt.price;
        }
        last.open = openPrice;
        last.high = highPrice;
        last.low = lowPrice;
        last.close = closePrice;
        currentBucketTicksRef.current = [
          openPrice,
          ...bucketRealTicks.map((t) => t.price),
        ];
      } else {
        last.open = prevClose;
        last.high = prevClose;
        last.low = prevClose;
        last.close = prevClose;
        currentBucketTicksRef.current = [prevClose];
      }

      // Set displayedPrice = targetPrice = latest real server price BEFORE first frame renders
      const latestRealPrice = Number(last.close.toFixed(decimals));
      targetPriceRef.current = latestRealPrice;
      displayedPriceRef.current = latestRealPrice;
      prevTickPriceRef.current = latestRealPrice;
      lastRealCloseRef.current = latestRealPrice;
      trueBucketOpenRef.current = last.open;
      trueBucketHighRef.current = last.high;
      trueBucketLowRef.current = last.low;
      currentCandleRef.current = { ...last };

      const newestHistoryTs =
        realTicksUsed.length > 0
          ? realTicksUsed[realTicksUsed.length - 1].timestampMs
          : Number(last.time) * 1000;
      lastHistoryTickTsRef.current = newestHistoryTs;
      lastProcessedTickTsRef.current = newestHistoryTs;
      latestServerTickRef.current = {
        price: latestRealPrice,
        timestampMs: newestHistoryTs,
      };

      candlesRef.current = candles;
      try {
        series.setData(candles);
      } catch {
        return;
      }
      setDataCallCountRef.current += 1;
      if (typeof window !== 'undefined') {
        (
          window as unknown as Record<string, unknown>
        ).__setDataCallCount = setDataCallCountRef.current;
      }
      console.info(
        `[PriceChart] series.setData called (#${setDataCallCountRef.current}) with ${candles.length} x ${CANDLE_INTERVAL_SECONDS}s candles (latestPrice=${latestRealPrice})`
      );

      setLatestServerPrice(latestRealPrice);
      try {
        if (
          easedPriceLineRef.current &&
          !disposedObjectsRef.current.has(easedPriceLineRef.current)
        ) {
          easedPriceLineRef.current.applyOptions({
            price: latestRealPrice,
            axisLabelVisible: true,
            lineVisible: true,
          });
        }
      } catch {
        // Ignore if disposed
      }

      // Mark history and real tick ready, then start the animation loop
      isHistoryReadyRef.current = true;
      hasRealTickRef.current = true;
      setIsChartLoading(false);
      startAnimationLoopRef.current();

      syncTradeMarkersAndLinesRef.current();
      try {
        chart.timeScale().scrollToRealTime();
      } catch {
        // Ignore if disposed
      }
      if (historyRafIdRef.current !== null) {
        cancelAnimationFrame(historyRafIdRef.current);
      }
      historyRafIdRef.current = requestAnimationFrame(() => {
        historyRafIdRef.current = null;
        if (isChartAliveRef.current) {
          syncPriceLineCoordinate(latestRealPrice);
        }
      });
    };

    if (!isSupabaseConfigured()) {
      const baseTicks = [...previewTicksRef.current];
      const fullTicks = ensureHistoryTicksFor30s(
        baseTicks,
        symbol,
        TARGET_HISTORY_CANDLES,
        activeAssetVolatilityRef.current
      );
      const candles = buildCandles(fullTicks, CANDLE_INTERVAL_SECONDS);
      applyCandlesToSeries(candles, baseTicks);
      return;
    }

    try {
      const supabase = createClient();

      // Ensure a fresh server tick is generated in Supabase before querying history
      try {
        await supabase.rpc('generate_ticks');
      } catch {
        // Ignore if RPC is not available
      }
      if (reqId !== historyLoadIdRef.current || !isChartAliveRef.current) return;

      let activeAssetId = resolvedAssetIdRef.current;

      // Query ONLY guaranteed schema column `id` so PostgREST never fails with HTTP 400
      if (!activeAssetId || activeAssetId.startsWith('demo-')) {
        const { data: assetRow } = await supabase
          .from('assets')
          .select('id')
          .eq('symbol', symbol)
          .maybeSingle();
        if (reqId !== historyLoadIdRef.current || !isChartAliveRef.current) return;
        if (assetRow?.id) {
          activeAssetId = assetRow.id;
          resolvedAssetIdRef.current = assetRow.id;
        }
      }

      // Confirmed Decision 1: Wait for real asset ID when Supabase is configured;
      // never render synthetic 89,420 demo candles while waiting for the real asset UUID.
      if (!activeAssetId || activeAssetId.startsWith('demo-')) {
        return;
      }

      // Fetch up to 3,500 real database ticks covering ~50 minutes
      const { data, error } = await supabase
        .from('price_ticks')
        .select('id, asset_id, price, created_at')
        .eq('asset_id', activeAssetId)
        .gte('created_at', sinceIso)
        .order('created_at', { ascending: false })
        .limit(3500);

      if (reqId !== historyLoadIdRef.current || !isChartAliveRef.current) return;

      let rawRows = !error && data ? (data as PriceTickRow[]) : [];

      // If no ticks fell inside the last 50 minutes, fetch the latest available DB ticks
      if (rawRows.length === 0) {
        const { data: fallbackRows } = await supabase
          .from('price_ticks')
          .select('id, asset_id, price, created_at')
          .eq('asset_id', activeAssetId)
          .order('created_at', { ascending: false })
          .limit(300);
        if (reqId !== historyLoadIdRef.current || !isChartAliveRef.current) return;
        if (fallbackRows && fallbackRows.length > 0) {
          rawRows = fallbackRows as PriceTickRow[];
        }
      }

      const rawDbTicks = rawRows
        .map((row) => {
          const tsMs = new Date(row.created_at).getTime();
          const priceVal = Number(Number(row.price).toFixed(decimals));
          if (row.id !== undefined) {
            seenTickKeysRef.current.add(`id:${row.id}`);
          }
          if (Number.isFinite(tsMs)) {
            seenTickTimestampsRef.current.add(tsMs);
          }
          return {
            price: priceVal,
            timestampMs: tsMs,
          };
        })
        .filter(
          (t) =>
            Number.isFinite(t.price) &&
            t.price > 0 &&
            Number.isFinite(t.timestampMs)
        )
        .sort((a, b) => a.timestampMs - b.timestampMs);

      // Filter out any stale pre-reset / pre-migration price cliff in the DB
      const dbTicks = filterContinuousRealTicks(
        rawDbTicks,
        symbol,
        activeAssetVolatilityRef.current
      );

      loadedRealAssetIdRef.current = activeAssetId;
      const latestTickAnchor =
        dbTicks.length > 0
          ? dbTicks[dbTicks.length - 1].price
          : resolvedAnchorPriceRef.current;

      const fullTicks = ensureHistoryTicksFor30s(
        dbTicks,
        symbol,
        TARGET_HISTORY_CANDLES,
        activeAssetVolatilityRef.current,
        latestTickAnchor
      );
      const candles = buildCandles(fullTicks, CANDLE_INTERVAL_SECONDS);
      applyCandlesToSeries(candles, dbTicks);
    } catch (err) {
      if (reqId !== historyLoadIdRef.current || !isChartAliveRef.current) return;
      setIsChartLoading(false);
      console.error('Failed to load 30s candle history from Supabase:', err);
    }
  }, [symbol, decimals, syncPriceLineCoordinate]);

  // ===========================================================================
  // TAB VISIBILITY & RECONNECT RESYNC (~5 minutes of ticks, snaps immediately)
  // ===========================================================================
  const resyncRecentTicks = useCallback(async () => {
    if (!isChartAliveRef.current || !seriesRef.current) return;

    const nowMs = Date.now();
    const nowBucketSec = (Math.floor(
      Math.floor(nowMs / 1000) / CANDLE_INTERVAL_SECONDS
    ) * CANDLE_INTERVAL_SECONDS) as UTCTimestamp;
    const sinceMs = nowMs - RESYNC_WINDOW_SECONDS * 1000;
    const sinceIso = new Date(sinceMs).toISOString();

    const mergeAndSnapCandles = (recentTicks: { price: number; timestampMs: number }[]) => {
      if (!isChartAliveRef.current) return;
      const series = seriesRef.current;
      const chart = chartRef.current;
      if (
        !series ||
        !chart ||
        disposedObjectsRef.current.has(series) ||
        disposedObjectsRef.current.has(chart)
      ) {
        return;
      }
      if (recentTicks.length === 0 && candlesRef.current.length === 0) return;

      const sortedRecent = [...recentTicks].sort(
        (a, b) => a.timestampMs - b.timestampMs
      );
      for (const rt of sortedRecent) {
        seenTickTimestampsRef.current.add(rt.timestampMs);
        if (rt.timestampMs > lastProcessedTickTsRef.current) {
          lastProcessedTickTsRef.current = rt.timestampMs;
        }
      }

      const anchorCandle =
        candlesRef.current.find(
          (c) => Number(c.time) * 1000 >= sinceMs - CANDLE_INTERVAL_SECONDS * 1000
        ) ?? candlesRef.current[candlesRef.current.length - 1];

      const seedTicks: RawTickInput[] = [];
      if (
        anchorCandle &&
        (sortedRecent.length === 0 ||
          Math.floor(sortedRecent[0].timestampMs / 1000) >=
            Number(anchorCandle.time) + CANDLE_INTERVAL_SECONDS)
      ) {
        seedTicks.push({
          price: anchorCandle.close,
          timestampMs: Number(anchorCandle.time) * 1000 + 1,
        });
      }
      for (const rt of sortedRecent) {
        seedTicks.push(rt);
      }

      const lastKnownPrice =
        sortedRecent.length > 0
          ? sortedRecent[sortedRecent.length - 1].price
          : targetPriceRef.current || anchorCandle?.close || getBasePriceForSymbol(symbol);

      // Ensure gap-filling extends through the current 30s clock bucket if no ticks in nowBucketSec yet
      const hasTickInNowBucket = sortedRecent.some(
        (t) =>
          Math.floor(Math.floor(t.timestampMs / 1000) / CANDLE_INTERVAL_SECONDS) *
            CANDLE_INTERVAL_SECONDS ===
          Number(nowBucketSec)
      );
      if (!hasTickInNowBucket) {
        seedTicks.push({
          price: lastKnownPrice,
          timestampMs: Number(nowBucketSec) * 1000 + 10,
        });
      }

      const rebuiltRecent = buildCandles(seedTicks, CANDLE_INTERVAL_SECONDS);
      if (rebuiltRecent.length === 0) return;

      for (const c of rebuiltRecent) {
        if (!isChartAliveRef.current || disposedObjectsRef.current.has(series)) {
          return;
        }
        const existingIdx = candlesRef.current.findIndex(
          (item) => item.time === c.time
        );
        if (existingIdx >= 0) {
          candlesRef.current[existingIdx] = c;
        } else if (
          candlesRef.current.length === 0 ||
          c.time > candlesRef.current[candlesRef.current.length - 1].time
        ) {
          candlesRef.current.push(c);
        }
        try {
          series.update(c);
        } catch {
          // Ignore if out of order
        }
      }

      if (candlesRef.current.length > MAX_CANDLES_IN_MEMORY) {
        candlesRef.current = candlesRef.current.slice(
          candlesRef.current.length - MAX_CANDLES_IN_MEMORY
        );
      }

      const newest = candlesRef.current[candlesRef.current.length - 1];
      if (newest) {
        const nowBucketRealTicks = sortedRecent
          .filter(
            (t) =>
              Math.floor(
                Math.floor(t.timestampMs / 1000) / CANDLE_INTERVAL_SECONDS
              ) *
                CANDLE_INTERVAL_SECONDS ===
              Number(newest.time)
          )
          .map((t) => t.price);

        currentBucketTicksRef.current = nowBucketRealTicks;
        currentCandleRef.current = { ...newest };

        // Rule 3: After a tab return or reconnect, SNAP to the target immediately with no animation
        targetPriceRef.current = newest.close;
        displayedPriceRef.current = newest.close;
        prevTickPriceRef.current = newest.close;
        lastRealCloseRef.current = newest.close;
        trueBucketOpenRef.current = newest.open;
        trueBucketHighRef.current = newest.high;
        trueBucketLowRef.current = newest.low;
        setLatestServerPrice(newest.close);
        try {
          if (
            easedPriceLineRef.current &&
            !disposedObjectsRef.current.has(easedPriceLineRef.current)
          ) {
            easedPriceLineRef.current.applyOptions({
              price: newest.close,
              axisLabelVisible: true,
              lineVisible: true,
            });
          }
        } catch {
          // Ignore if disposed
        }
        syncPriceLineCoordinate(newest.close);
      }
    };

    if (!isSupabaseConfigured()) {
      const recentPreview = previewTicksRef.current.filter(
        (t) => t.timestampMs >= sinceMs
      );
      mergeAndSnapCandles(recentPreview);
      return;
    }

    const activeAssetId = resolvedAssetIdRef.current ?? assetId;
    if (!activeAssetId || activeAssetId.startsWith('demo-')) {
      return;
    }

    try {
      const supabase = createClient();
      const { data, error } = await supabase
        .from('price_ticks')
        .select('id, asset_id, price, created_at')
        .eq('asset_id', activeAssetId)
        .gte('created_at', sinceIso)
        .order('created_at', { ascending: true })
        .limit(600);

      if (!isChartAliveRef.current) return;

      if (!error && data) {
        const ticks = (data as PriceTickRow[]).map((row) => {
          if (row.id !== undefined) {
            seenTickKeysRef.current.add(`id:${row.id}`);
          }
          return {
            price: Number(Number(row.price).toFixed(decimals)),
            timestampMs: new Date(row.created_at).getTime(),
          };
        });
        mergeAndSnapCandles(ticks);
      }
    } catch {
      // Ignore transient network errors during resync
    }
  }, [assetId, symbol, decimals, syncPriceLineCoordinate]);

  // Reset per-asset state and load history when symbol changes
  useEffect(() => {
    isHistoryReadyRef.current = false;
    hasRealTickRef.current = false;
    stopAnimationLoopRef.current();
    latestServerTickRef.current = null;
    previewTicksRef.current = [];
    currentCandleRef.current = null;
    currentBucketTicksRef.current = [];
    seenTickKeysRef.current.clear();
    seenTickTimestampsRef.current.clear();
    lastHistoryTickTsRef.current = 0;
    lastProcessedTickTsRef.current = 0;
    targetPriceRef.current = 0;
    displayedPriceRef.current = 0;
    prevTickPriceRef.current = 0;
    lastRealCloseRef.current = 0;
    trueBucketOpenRef.current = 0;
    trueBucketHighRef.current = 0;
    trueBucketLowRef.current = 0;
    loadedRealAssetIdRef.current = undefined;
    resolvedAssetIdRef.current =
      assetId && !assetId.startsWith('demo-') ? assetId : undefined;
    resolvedAnchorPriceRef.current = undefined;
    loadInitialHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol, loadInitialHistory]);

  // If `assetId` transitions from `demo-*` to a real Supabase UUID before history
  // has loaded for that real UUID, immediately load the real DB history.
  useEffect(() => {
    if (assetId && !assetId.startsWith('demo-')) {
      resolvedAssetIdRef.current = assetId;
      if (
        !isHistoryReadyRef.current ||
        loadedRealAssetIdRef.current !== assetId
      ) {
        loadInitialHistory();
      }
    }
  }, [assetId, loadInitialHistory]);

  // ===========================================================================
  // SMOOTH LIVE MOVEMENT LOOP (requestAnimationFrame) + TAB VISIBILITY PAUSE/RESYNC
  // IMPORTANT:
  // 1. Does NOT start until `isHistoryReadyRef.current && hasRealTickRef.current`.
  // 2. Clamps `displayedPrice` strictly into `[min(prevTick, latestTick), max(prevTick, latestTick)]`
  //    so easing can NEVER push a candle's high or low beyond real tick prices.
  // 3. Snaps immediately if `|target - displayed| > 3 * normalPerTickMove`.
  // 4. Caps the animation step per frame.
  // 5. Runs the 5x median range safety guard on every candle update.
  // ===========================================================================
  useEffect(() => {
    let isCancelled = false;
    const snapEpsilon = minMove * 0.05;

    const stepAnimation = () => {
      if (
        isCancelled ||
        isTabHiddenRef.current ||
        !isChartAliveRef.current ||
        !isHistoryReadyRef.current ||
        !hasRealTickRef.current
      ) {
        rafIdRef.current = null;
        return;
      }

      const series = seriesRef.current;
      const chart = chartRef.current;
      const prevCandle = currentCandleRef.current;
      const target = targetPriceRef.current;

      if (
        series &&
        chart &&
        !disposedObjectsRef.current.has(series) &&
        !disposedObjectsRef.current.has(chart) &&
        prevCandle &&
        target > 0
      ) {
        const nowSec = Math.floor(Date.now() / 1000);
        const tickSec = latestServerTickRef.current
          ? Math.floor(latestServerTickRef.current.timestampMs / 1000)
          : nowSec;
        const effectiveSec = Math.max(nowSec, tickSec);
        const bucketSec = (Math.floor(effectiveSec / CANDLE_INTERVAL_SECONDS) *
          CANDLE_INTERVAL_SECONDS) as UTCTimestamp;

        try {
          // 1. Check if a new 30s clock bucket (:00 or :30) has started before a new tick arrived
          if (bucketSec > prevCandle.time) {
            const trueServerClose = Number(
              (lastRealCloseRef.current || target).toFixed(decimals)
            );

            // Finalize the previous candle using ONLY real tick values (never eased price)
            const finalizedPrev: CandlePoint = guardAndClampCandleRange(
              {
                time: prevCandle.time,
                open: prevCandle.open,
                high: Math.max(
                  prevCandle.open,
                  trueBucketHighRef.current || trueServerClose,
                  trueServerClose
                ),
                low: Math.min(
                  prevCandle.open,
                  trueBucketLowRef.current || trueServerClose,
                  trueServerClose
                ),
                close: trueServerClose,
              },
              'bucket-rollover-clock'
            );
            if (candlesRef.current.length > 0) {
              candlesRef.current[candlesRef.current.length - 1] = finalizedPrev;
            }
            series.update(finalizedPrev);

            // Gap-fill any intermediate 30s buckets with flat candles at the previous real close
            let fillBucket = (Number(prevCandle.time) +
              CANDLE_INTERVAL_SECONDS) as UTCTimestamp;
            while (fillBucket < bucketSec) {
              const flatCandle: CandlePoint = {
                time: fillBucket,
                open: trueServerClose,
                high: trueServerClose,
                low: trueServerClose,
                close: trueServerClose,
              };
              candlesRef.current.push(flatCandle);
              series.update(flatCandle);
              fillBucket = (Number(fillBucket) +
                CANDLE_INTERVAL_SECONDS) as UTCTimestamp;
            }

            // Open the new 30s candle at the previous candle's real close (since no ticks in this bucket yet)
            displayedPriceRef.current = trueServerClose;
            targetPriceRef.current = trueServerClose;
            prevTickPriceRef.current = trueServerClose;
            trueBucketOpenRef.current = trueServerClose;
            trueBucketHighRef.current = trueServerClose;
            trueBucketLowRef.current = trueServerClose;
            currentBucketTicksRef.current = [];

            const newCandle: CandlePoint = {
              time: bucketSec,
              open: trueServerClose,
              high: trueServerClose,
              low: trueServerClose,
              close: trueServerClose,
            };
            currentCandleRef.current = newCandle;
            candlesRef.current.push(newCandle);
            if (candlesRef.current.length > MAX_CANDLES_IN_MEMORY) {
              candlesRef.current.shift();
            }
            series.update(newCandle);
            if (
              easedPriceLineRef.current &&
              !disposedObjectsRef.current.has(easedPriceLineRef.current)
            ) {
              easedPriceLineRef.current.applyOptions({ price: trueServerClose });
            }
            syncPriceLineCoordinate(trueServerClose);
          } else {
            // 2. Ease displayedPrice toward targetPrice within the current 30s candle
            let displayed =
              displayedPriceRef.current > 0 ? displayedPriceRef.current : target;
            const prevTick =
              prevTickPriceRef.current > 0 ? prevTickPriceRef.current : target;
            const diff = target - displayed;

            if (Math.abs(diff) > 0) {
              const volPct = getVolatilityPctForSymbol(
                symbol,
                activeAssetVolatilityRef.current
              );
              const normalPerTickMove = Math.max(
                minMove,
                target * (volPct / 100)
              );
              const maxSnapGap = SNAP_GAP_MULTIPLIER * normalPerTickMove;
              const maxStepPerFrame = Math.max(
                minMove,
                normalPerTickMove * MAX_FRAME_STEP_RATIO
              );

              // Rule 3b: If gap > 3x normal per-tick move, SNAP immediately with no animation
              if (
                Math.abs(diff) > maxSnapGap ||
                Math.abs(diff) <= snapEpsilon
              ) {
                displayed = target;
                prevTickPriceRef.current = target;
              } else {
                // Rule 3c: Cap the animation step per frame
                const rawStep = diff * CANDLE_EASING_FACTOR;
                const cappedStep =
                  Math.sign(rawStep) *
                  Math.min(Math.abs(rawStep), maxStepPerFrame);
                displayed = displayed + cappedStep;
              }

              // Rule 3a: Clamp displayedPrice strictly into [min(prevTick, latestTick), max(prevTick, latestTick)]
              const minTickBound = Math.min(prevTick, target);
              const maxTickBound = Math.max(prevTick, target);
              displayed = Math.min(
                maxTickBound,
                Math.max(minTickBound, displayed)
              );

              displayedPriceRef.current = displayed;

              // High and low are governed strictly by real ticks in the current 30s bucket,
              // never pushed beyond real tick bounds by the eased price.
              const realBucketHigh = Math.max(
                prevCandle.open,
                trueBucketHighRef.current || target,
                target
              );
              const realBucketLow = Math.min(
                prevCandle.open,
                trueBucketLowRef.current || target,
                target
              );
              const clampedDisplayedClose = Math.min(
                realBucketHigh,
                Math.max(realBucketLow, Number(displayed.toFixed(decimals)))
              );

              const candidateCandle: CandlePoint = {
                time: prevCandle.time,
                open: prevCandle.open,
                high: realBucketHigh,
                low: realBucketLow,
                close: clampedDisplayedClose,
              };

              // Rule 5: Run 5x median range safety guard
              const updatedCandle = guardAndClampCandleRange(
                candidateCandle,
                'raf-step'
              );

              currentCandleRef.current = updatedCandle;
              if (candlesRef.current.length > 0) {
                candlesRef.current[candlesRef.current.length - 1] = updatedCandle;
              }

              series.update(updatedCandle);
              if (
                easedPriceLineRef.current &&
                !disposedObjectsRef.current.has(easedPriceLineRef.current)
              ) {
                easedPriceLineRef.current.applyOptions({
                  price: updatedCandle.close,
                });
              }
              syncPriceLineCoordinate(updatedCandle.close);
            }
          }
        } catch {
          // Ignore if chart/series was disposed mid-frame
        }
      }

      if (
        !isCancelled &&
        !isTabHiddenRef.current &&
        isChartAliveRef.current &&
        isHistoryReadyRef.current &&
        hasRealTickRef.current
      ) {
        rafIdRef.current = requestAnimationFrame(stepAnimation);
      } else {
        rafIdRef.current = null;
      }
    };

    const startLoop = () => {
      if (
        rafIdRef.current === null &&
        !isTabHiddenRef.current &&
        !isCancelled &&
        isChartAliveRef.current &&
        isHistoryReadyRef.current &&
        hasRealTickRef.current
      ) {
        rafIdRef.current = requestAnimationFrame(stepAnimation);
      }
    };

    const stopLoop = () => {
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
    };

    startAnimationLoopRef.current = startLoop;
    stopAnimationLoopRef.current = stopLoop;

    const handleVisibilityChange = () => {
      const hidden = document.hidden;
      isTabHiddenRef.current = hidden;
      if (hidden) {
        stopLoop();
      } else if (!isCancelled && isChartAliveRef.current) {
        resyncRecentTicks().finally(() => {
          if (
            !isCancelled &&
            isChartAliveRef.current &&
            isHistoryReadyRef.current &&
            hasRealTickRef.current
          ) {
            startLoop();
          }
        });
      }
    };

    isTabHiddenRef.current =
      typeof document !== 'undefined' ? document.hidden : false;
    if (
      !isTabHiddenRef.current &&
      isHistoryReadyRef.current &&
      hasRealTickRef.current
    ) {
      startLoop();
    }

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      isCancelled = true;
      stopLoop();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [
    symbol,
    decimals,
    minMove,
    guardAndClampCandleRange,
    resyncRecentTicks,
    syncPriceLineCoordinate,
  ]);

  // ===========================================================================
  // TICK DELIVERY (1 tick/sec) & AUTO-RECONNECTING SUPABASE REALTIME STREAM
  // IMPORTANT: When Supabase is configured, NEVER run the offline preview generator
  // even if `assetId` prop is temporarily `demo-*` while TradingTerminal bootstraps.
  // ===========================================================================
  useEffect(() => {
    let isDisposed = false;

    // Offline / preview mode fallback ONLY when Supabase is NOT configured
    if (!isSupabaseConfigured()) {
      setStreamStatus('preview');
      let anchorPrice = targetPriceRef.current || getBasePriceForSymbol(symbol);
      let lastReturn = 0;
      let burstUntilMs = 0;
      let burstMultiplier = 1.0;
      let nextBurstAtMs = Date.now() + (120 + Math.random() * 120) * 1000;

      const liveSecondTimer = setInterval(() => {
        if (isDisposed || isTabHiddenRef.current || !isHistoryReadyRef.current) {
          return;
        }
        const nowMs = Date.now();
        const cur = targetPriceRef.current || getBasePriceForSymbol(symbol);

        anchorPrice = 0.9997 * anchorPrice + 0.0003 * cur;

        if (nowMs < burstUntilMs) {
          // Active burst continues
        } else if (nowMs >= nextBurstAtMs) {
          burstMultiplier = 1.5 + Math.random() * 1.0;
          const burstDurationMs = (10 + Math.random() * 10) * 1000;
          burstUntilMs = nowMs + burstDurationMs;
          nextBurstAtMs = burstUntilMs + (120 + Math.random() * 120) * 1000;
        } else {
          burstMultiplier = 1.0;
        }

        const volPct = getVolatilityPctForSymbol(
          symbol,
          activeAssetVolatilityRef.current
        );
        const sigma = (volPct / 100.0) * burstMultiplier;
        const z = randomBoxMuller();

        const freshNoise = sigma * z;
        const momentumMove = 0.85 * freshNoise + 0.15 * lastReturn;
        lastReturn = momentumMove;

        const deviation = (cur - anchorPrice) / anchorPrice;
        const reversion = -0.0015 * deviation;
        const rawNext = cur * (1.0 + momentumMove + reversion);
        const clampedNext = Math.min(
          anchorPrice * 1.03,
          Math.max(anchorPrice * 0.97, rawNext)
        );
        const nextPrice = Math.max(
          minMove,
          Number(clampedNext.toFixed(decimals))
        );

        previewTicksRef.current.push({ price: nextPrice, timestampMs: nowMs });
        if (previewTicksRef.current.length > 5000) {
          previewTicksRef.current.shift();
        }
        handleIncomingServerTick(nextPrice, nowMs);
      }, 1000);

      return () => {
        isDisposed = true;
        clearInterval(liveSecondTimer);
      };
    }

    const supabase = createClient();
    let activeChannel: ReturnType<typeof supabase.channel> | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let reconnectAttempt = 0;
    let hadConnectedOnce = false;

    const initRealtimeStream = async () => {
      let targetAssetId =
        assetId && !assetId.startsWith('demo-')
          ? assetId
          : resolvedAssetIdRef.current;

      if (!targetAssetId || targetAssetId.startsWith('demo-')) {
        const { data: assetRow } = await supabase
          .from('assets')
          .select('id')
          .eq('symbol', symbol)
          .maybeSingle();
        if (isDisposed) return;
        if (assetRow?.id) {
          targetAssetId = assetRow.id;
          resolvedAssetIdRef.current = assetRow.id;
        }
      }

      if (isDisposed || !targetAssetId || targetAssetId.startsWith('demo-')) {
        return;
      }

      const subscribeToStream = () => {
        if (isDisposed) return;
        if (activeChannel) {
          supabase.removeChannel(activeChannel);
          activeChannel = null;
        }

        setStreamStatus('connecting');
        const channelId = `price_ticks_${targetAssetId}_${Date.now()}_${Math.random()
          .toString(36)
          .slice(2, 7)}`;

        activeChannel = supabase
          .channel(channelId)
          .on(
            'postgres_changes',
            {
              event: 'INSERT',
              schema: 'public',
              table: 'price_ticks',
              filter: `asset_id=eq.${targetAssetId}`,
            },
            (payload) => {
              if (isDisposed) return;
              const newRow = payload.new as PriceTickRow;
              const priceNum = Number(newRow.price);
              const ts = newRow.created_at
                ? new Date(newRow.created_at).getTime()
                : Date.now();
              handleIncomingServerTick(priceNum, ts, newRow.id);
            }
          )
          .subscribe((status) => {
            if (isDisposed) return;
            if (status === 'SUBSCRIBED') {
              setStreamStatus('realtime');
              reconnectAttempt = 0;
              if (hadConnectedOnce) {
                // Backfill any missed ticks during the drop and snap immediately
                resyncRecentTicks();
              }
              hadConnectedOnce = true;
            } else if (
              status === 'CHANNEL_ERROR' ||
              status === 'TIMED_OUT' ||
              status === 'CLOSED'
            ) {
              setStreamStatus('connecting');
              if (reconnectTimer) clearTimeout(reconnectTimer);
              const delayMs = Math.min(
                10000,
                1000 * Math.pow(2, reconnectAttempt)
              );
              reconnectAttempt += 1;
              reconnectTimer = setTimeout(() => {
                subscribeToStream();
              }, delayMs);
            }
          });
      };

      subscribeToStream();
    };

    initRealtimeStream();

    // Ensure 1-second tick cadence and 5-second trade settlement fallback
    // without overlapping RPC calls if pg_cron is not running sub-minute.
    let tickRpcInFlight = false;
    let tickSecondCount = 0;
    const rpcHeartbeat = setInterval(async () => {
      if (
        isDisposed ||
        isTabHiddenRef.current ||
        tickRpcInFlight ||
        !isHistoryReadyRef.current
      ) {
        return;
      }
      tickRpcInFlight = true;
      tickSecondCount += 1;
      try {
        await supabase.rpc('generate_ticks');
        if (tickSecondCount % 5 === 0) {
          await supabase.rpc('settle_expired_trades');
        }
      } catch {
        // Ignore if RPC not yet installed
      } finally {
        tickRpcInFlight = false;
      }
    }, 1000);

    return () => {
      isDisposed = true;
      clearInterval(rpcHeartbeat);
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (activeChannel) {
        supabase.removeChannel(activeChannel);
      }
    };
  }, [assetId, symbol, decimals, minMove, handleIncomingServerTick, resyncRecentTicks]);

  function handleZoom(direction: 'in' | 'out') {
    if (!isChartAliveRef.current || !chartRef.current) return;
    if (disposedObjectsRef.current.has(chartRef.current)) return;
    try {
      const timeScale = chartRef.current.timeScale();
      const currentSpacing = timeScale.options().barSpacing;
      const nextSpacing =
        direction === 'in'
          ? Math.min(45, currentSpacing + 4)
          : Math.max(8, currentSpacing - 4);
      timeScale.applyOptions({ barSpacing: nextSpacing });
    } catch {
      // Ignore if disposed
    }
  }

  const activeClockMs = nowMs > 0 ? nowMs : Date.now();
  const combinedOpenTrades = (
    openTrades.length > 0 ? openTrades : openTrade ? [openTrade] : []
  ).filter((t) => new Date(t.expiresAt).getTime() > activeClockMs);

  const currentSpotForOverlay =
    latestServerPrice ||
    targetPriceRef.current ||
    displayedPriceRef.current ||
    getBasePriceForSymbol(symbol);

  const winningOpenReturn = combinedOpenTrades.reduce((acc, t) => {
    const isWin =
      (t.direction === 'CALL' && currentSpotForOverlay > t.entryPrice) ||
      (t.direction === 'PUT' && currentSpotForOverlay < t.entryPrice);
    if (isWin) {
      return acc + t.amount + (t.amount * t.payoutPercent) / 100;
    }
    return acc;
  }, 0);

  // Compute coordinates for the 1.5s RESULT (P/L) chart badge when a trade settles
  let resultBadgeCoords: { x: number; y: number } | null = null;
  if (
    recentTradeResult &&
    isChartAliveRef.current &&
    seriesRef.current &&
    chartRef.current &&
    !disposedObjectsRef.current.has(seriesRef.current) &&
    !disposedObjectsRef.current.has(chartRef.current)
  ) {
    try {
      const container = chartContainerRef.current;
      const chartWidth = container?.clientWidth || 800;
      const chartHeight = container?.clientHeight || 500;
      const plotWidth = Math.max(220, chartWidth - rightScaleWidth);
      const plotHeight = Math.max(120, chartHeight - timeScaleHeight);

      const rawY =
        seriesRef.current.priceToCoordinate(recentTradeResult.exitPrice) ??
        priceLineY;
      const clampedY =
        rawY !== null && Number.isFinite(rawY)
          ? Math.max(36, Math.min(plotHeight - 36, Math.round(rawY)))
          : Math.round(plotHeight * 0.35);

      let rawX: number | null = null;
      if (candlesRef.current.length > 0) {
        const lastCandle = candlesRef.current[candlesRef.current.length - 1];
        rawX = chartRef.current.timeScale().timeToCoordinate(lastCandle.time);
      }
      const clampedX =
        rawX !== null && Number.isFinite(rawX)
          ? Math.max(160, Math.min(plotWidth - 20, Math.round(rawX)))
          : Math.round(plotWidth * 0.72);

      resultBadgeCoords = { x: clampedX, y: clampedY };
    } catch {
      resultBadgeCoords = null;
    }
  }

  return (
    <div className="absolute inset-0 w-full h-full bg-[#171a23] overflow-hidden select-none">
      {/* Watermark DEMO */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0 left-0 lg:left-11 right-0 flex items-center justify-center z-[1]"
      >
        <span className="text-[72px] sm:text-[110px] xl:text-[180px] font-black tracking-[0.2em] text-transparent [-webkit-text-stroke:2px_rgba(255,255,255,0.03)] select-none">
          DEMO
        </span>
      </div>

      {/* DESKTOP DEDICATED FULL-HEIGHT LEFT STRIP FOR [+] ASSET BUTTON & SENTIMENT BAR */}
      <div className="hidden lg:flex absolute left-0 top-0 bottom-0 w-11 bg-[#141722] border-r border-[#232838] z-[20] flex-col items-center pt-3 pb-2.5">
        <button
          type="button"
          onClick={() => setAssetMenuOpen((prev) => !prev)}
          title="Select Asset Pair"
          className="w-8 h-8 rounded-lg bg-[#1d8cf8] hover:bg-[#167ae0] text-white flex items-center justify-center shadow cursor-pointer transition-colors shrink-0"
        >
          <Plus className="w-5 h-5" />
        </button>

        {/* Full-Height Vertical Sentiment Bar (Red Top / Green Bottom) */}
        <div className="flex-1 w-full flex flex-col items-center pt-3 pb-1 pointer-events-none">
          <span className="text-[11px] font-bold text-white font-mono mb-1.5 tabular-nums">
            {100 - bullishPercent}%
          </span>
          <div className="flex-1 w-1 bg-[#252a3a] rounded-full overflow-hidden flex flex-col">
            <div
              style={{ height: `${100 - bullishPercent}%` }}
              className="w-full bg-[#e34c3b] transition-all duration-300"
            />
            <div
              style={{ height: `${bullishPercent}%` }}
              className="w-full bg-[#22ab68] transition-all duration-300"
            />
          </div>
          <span className="text-[11px] font-bold text-white font-mono mt-1.5 tabular-nums">
            {bullishPercent}%
          </span>
        </div>
      </div>

      {/* Beginning of trade / End of trade vertical guide lines & 30s candle countdown */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0 right-[32%] sm:right-[26%] lg:right-[24%] w-24 lg:w-28 border-l border-dashed border-slate-300/60 border-r border-r-slate-500/40 z-[4] flex flex-col justify-between py-3"
      >
        <div className="flex items-center justify-between text-[10px] lg:text-[11px] text-[#7c849b] font-sans whitespace-nowrap">
          <span className="-translate-x-[108%] pr-2">Beginning of trade ▸</span>
          <span className="pl-2">◂ End of trade</span>
        </div>
        <div
          style={
            priceLineY !== null
              ? { top: `${Math.max(20, priceLineY - 10)}px` }
              : undefined
          }
          className="self-start -translate-x-1/2 top-1/2 absolute px-1.5 py-0.5 rounded bg-[#2a3042] border border-[#3a4259] text-[10px] font-mono font-bold text-slate-100 tabular-nums shadow"
        >
          {formatCountdownLabel(candleCountdown)}
        </div>
      </div>

      {/* Lightweight-Charts Canvas Container: Fills 100% height & width from the left sentiment strip to the right edge */}
      <div
        ref={chartContainerRef}
        className="absolute inset-y-0 left-0 lg:left-11 right-0 z-[2]"
      />

      {/* Animated Candlestick Pulse Chart Loader while historical candles sync */}
      {isChartLoading && (
        <LoadingScreen
          variant="chart"
          symbol={symbol}
          label={`Synchronizing ${symbol} Market Feed`}
        />
      )}

      {/* INSTANT BUY (GREEN) / SELL (RED) DIRECTIONAL HOVER HIGHLIGHT ZONE */}
      {hoverDirection === 'CALL' && priceLineY !== null && priceLineY > 0 && (
        <div
          aria-hidden="true"
          style={{
            top: 0,
            right: `${rightScaleWidth}px`,
            height: `${priceLineY}px`,
          }}
          className="pointer-events-none absolute left-0 lg:left-11 z-[3] bg-gradient-to-t from-[#22ab68]/25 via-[#22ab68]/15 to-[#22ab68]/5 border-b border-dashed border-[#22ab68]"
        />
      )}

      {hoverDirection === 'PUT' && priceLineY !== null && (
        <div
          aria-hidden="true"
          style={{
            top: `${Math.max(0, priceLineY)}px`,
            right: `${rightScaleWidth}px`,
            bottom: `${timeScaleHeight}px`,
          }}
          className="pointer-events-none absolute left-0 lg:left-11 z-[3] bg-gradient-to-b from-[#e34c3b]/25 via-[#e34c3b]/15 to-[#e34c3b]/5 border-t border-dashed border-[#e34c3b]"
        />
      )}

      {/* MOBILE TOP-LEFT OVERLAYS */}
      <div className="lg:hidden absolute left-3 top-3 z-[20] flex items-start gap-2.5">
        <div className="flex flex-col gap-2">
          {/* ••• Tools Button */}
          <button
            type="button"
            onClick={() => setMobileToolsOpen((prev) => !prev)}
            title="Chart Tools"
            className="w-11 h-11 rounded-xl bg-[#2a3042]/95 border border-[#363d52] text-slate-200 flex items-center justify-center shadow-lg cursor-pointer active:scale-95 transition-transform"
          >
            <MoreHorizontal className="w-5 h-5" />
          </button>

          {/* Briefcase Trades Drawer Toggle Button */}
          <button
            type="button"
            onClick={() => onToggleMobileTradesDrawer?.()}
            title="Toggle Trades & History Drawer"
            className={`relative w-11 h-11 rounded-xl flex items-center justify-center shadow-lg cursor-pointer active:scale-95 transition-all ${
              mobileTradesDrawerOpen
                ? 'bg-[#1d8cf8] text-white border border-[#3898ff]'
                : 'bg-[#2a3042]/95 text-slate-200 border border-[#363d52]'
            }`}
          >
            <Briefcase className="w-5 h-5" />
            {mobileTradesDrawerOpen ? (
              <span className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-[#2a3042] border border-[#3e465e] text-slate-200 flex items-center justify-center text-[10px] font-bold shadow">
                <X className="w-3 h-3" />
              </span>
            ) : (
              totalTradesBadgeCount > 0 && (
                <span className="absolute -top-1.5 -right-1.5 min-w-[20px] h-5 px-1 rounded-full bg-[#1d8cf8] text-white flex items-center justify-center text-[10px] font-bold shadow tabular-nums">
                  {totalTradesBadgeCount}
                </span>
              )
            )}
          </button>

          {mobileToolsOpen && (
            <div className="mt-1 p-1.5 rounded-xl bg-[#1c202e]/95 border border-[#2e3446] shadow-xl flex flex-col gap-1.5">
              <button
                type="button"
                onClick={() => {
                  chartRef.current?.timeScale().scrollToRealTime();
                  setMobileToolsOpen(false);
                }}
                title="Reset Chart Position"
                className="w-9 h-9 rounded-lg bg-[#252a3a] text-slate-200 flex items-center justify-center"
              >
                <Pencil className="w-4 h-4" />
              </button>

              <button
                type="button"
                onClick={() => {
                  chartRef.current?.timeScale().fitContent();
                  setMobileToolsOpen(false);
                }}
                title="Fit All Candles"
                className="w-9 h-9 rounded-lg bg-[#252a3a] text-slate-200 flex items-center justify-center"
              >
                <BarChart2 className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>

        {/* UTC Clock + Blue Info Circle */}
        <div className="flex items-center gap-2 pt-1">
          <div className="flex items-start gap-1.5 text-[11px] font-mono text-slate-300 leading-tight tabular-nums">
            <span className="w-2 h-2 rounded-full mt-1 shrink-0 bg-[#22ab68]" />
            <div>
              <div className="font-bold text-slate-100">{utcTimeStr}</div>
              <div className="text-[10px] text-[#7c849b]">UTC</div>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setPairInfoOpen(true)}
            title="Pair Information"
            className="w-6 h-6 rounded-full bg-[#1d8cf8] text-white flex items-center justify-center shadow cursor-pointer"
          >
            <span className="font-serif italic font-bold text-xs leading-none">
              i
            </span>
          </button>
        </div>
      </div>

      {/* DESKTOP TOP-LEFT FLOATING ASSET SELECTOR & PAIR INFO */}
      <div className="hidden lg:flex absolute left-14 top-3 z-[20] flex-col gap-2">
        <div className="relative">
          <button
            type="button"
            onClick={() => setAssetMenuOpen((prev) => !prev)}
            className="bg-[#0b0d13]/95 backdrop-blur-md hover:bg-[#121621] border border-[#232838] rounded-lg px-3.5 py-1.5 flex items-center gap-2.5 cursor-pointer transition-colors min-w-[180px]"
          >
            <div className="flex flex-col items-center shrink-0">
              <div className="relative flex items-center w-6 h-5">
                <span className="w-4 h-4 rounded-full bg-[#1d4ed8] border border-white/40 flex items-center justify-center text-[8px] font-bold text-white">
                  {symbol.slice(0, 1)}
                </span>
                <span className="w-4 h-4 rounded-full bg-[#e34c3b] border border-white/40 flex items-center justify-center text-[8px] font-bold text-white -ml-1.5">
                  +
                </span>
              </div>
              {combinedOpenTrades.length > 0 && (
                <span className="text-[10px] font-mono font-bold text-slate-300 leading-none mt-0.5 tabular-nums">
                  +{combinedOpenTrades.length}
                </span>
              )}
            </div>
            <div className="text-left flex-1">
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs font-bold text-white whitespace-nowrap">
                  {symbol} (OTC)
                </span>
                <ChevronDown className="w-3.5 h-3.5 text-slate-300" />
              </div>
              <div className="flex items-center gap-1.5 mt-0.5">
                <span className="text-[11px] font-extrabold text-[#f59e0b] font-mono tabular-nums">
                  {payoutPercent}%
                </span>
                {combinedOpenTrades.length > 0 && (
                  <span
                    className={`px-1.5 py-0.5 rounded text-[10px] font-mono font-extrabold text-white leading-none tabular-nums ${
                      winningOpenReturn > 0 ? 'bg-[#22ab68]' : 'bg-[#e34c3b]'
                    }`}
                  >
                    {winningOpenReturn > 0
                      ? formatMoney(winningOpenReturn, { showPlusSign: true })
                      : formatMoney(0)}
                  </span>
                )}
              </div>
            </div>
          </button>

          {assetMenuOpen && (
            <div className="absolute left-0 top-12 w-64 bg-[#1c202b] border border-[#2e3446] rounded-xl shadow-2xl py-2 z-[40]">
              <div className="px-3 py-1.5 border-b border-[#262b38] flex items-center justify-between text-[11px] font-bold text-[#8c94ab]">
                <span>SELECT INSTRUMENT</span>
                <span>PAYOUT</span>
              </div>
              {assets.map((item) => {
                const active = item.symbol === symbol;
                const pct = `${item.payoutPercent ?? 85}%`;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      onSelectSymbol(item.symbol);
                      setAssetMenuOpen(false);
                    }}
                    className={`w-full min-h-[44px] px-3 py-2 text-left flex items-center justify-between text-xs transition-colors cursor-pointer ${
                      active
                        ? 'bg-[#252b3b] text-white font-bold'
                        : 'text-slate-300 hover:bg-[#232837]'
                    }`}
                  >
                    <div>
                      <div>{item.symbol} (OTC)</div>
                      <div className="text-[10px] text-[#7c849b]">
                        {item.name}
                      </div>
                    </div>
                    <span className="font-mono font-bold text-[#f59e0b] tabular-nums">
                      {pct}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex flex-col items-start gap-2 pt-1">
          <div className="flex items-center gap-1.5 text-[10px] font-mono text-[#8c94ab] tabular-nums">
            <span className="w-2 h-2 rounded-full bg-[#22ab68] shadow-[0_0_6px_#22ab68]" />
            <span className="text-slate-300">{utcTimeStr}</span>
            <span>UTC</span>
          </div>

          <button
            type="button"
            onClick={() => setPairInfoOpen(true)}
            className="px-3 py-1.5 rounded-full bg-[#182235]/90 hover:bg-[#1f2c44] border border-[#243452] text-[#3898ff] text-[10px] font-extrabold tracking-wide flex items-center gap-1.5 cursor-pointer transition-colors"
          >
            <span className="w-4 h-4 rounded-full bg-[#1d8cf8] text-white flex items-center justify-center font-serif italic font-bold text-[10px]">
              i
            </span>
            <span>PAIR INFORMATION</span>
          </button>
        </div>
      </div>

      {/* QUOTEX-STYLE COORDINATE-SYNCED OPEN TRADE ENTRY LINES, DOTS & PILLS */}
      {tradeOverlayCoords.length > 0 && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 left-0 lg:left-11 right-0 z-[15] overflow-hidden"
        >
          {tradeOverlayCoords.map((t) => {
            const isCall = t.direction === 'CALL';
            const accentBg = isCall ? 'bg-[#22ab68]' : 'bg-[#e34c3b]';
            const accentBorder = isCall
              ? 'border-[#22ab68]'
              : 'border-[#e34c3b]';
            const faintBg = isCall ? 'bg-[#22ab68]/35' : 'bg-[#e34c3b]/35';

            const pillRightX = Math.max(84, t.entryX - 8 - t.pillOffsetX);
            const effectiveClockMs = nowMs > 0 ? nowMs : Date.now();
            const remSec = Math.max(
              0,
              Math.ceil(
                (new Date(t.expiresAt).getTime() - effectiveClockMs) / 1000
              )
            );
            const mm = String(Math.floor(remSec / 60)).padStart(2, '0');
            const ss = String(remSec % 60).padStart(2, '0');
            const timerLabel = `${mm}:${ss}`;

            return (
              <React.Fragment key={t.id}>
                {/* Solid horizontal segment from pill right edge through entry dot to end dot */}
                <div
                  style={{
                    left: `${pillRightX}px`,
                    width: `${Math.max(0, t.endX - pillRightX)}px`,
                    top: `${t.y}px`,
                  }}
                  className={`absolute -translate-y-1/2 h-[2px] ${accentBg} z-[1]`}
                />

                {/* Faint extended horizontal guide line from end dot to right price axis */}
                <div
                  style={{
                    left: `${t.endX}px`,
                    right: `${rightScaleWidth}px`,
                    top: `${t.y}px`,
                  }}
                  className={`absolute -translate-y-1/2 h-[1px] ${faintBg} z-[1]`}
                />

                {/* Entry Dot at (entryX, y) */}
                <div
                  style={{
                    left: `${t.entryX}px`,
                    top: `${t.y}px`,
                  }}
                  className={`absolute -translate-x-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full bg-white border-[2.5px] ${accentBorder} shadow-sm z-[2]`}
                />

                {/* End Dot at (endX, y) */}
                <div
                  style={{
                    left: `${t.endX}px`,
                    top: `${t.y}px`,
                  }}
                  className={`absolute -translate-x-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full bg-white border-[2.5px] ${accentBorder} shadow-sm z-[2]`}
                />

                {/* Left Pill Badge: [ ↑ 1 $ 00:32 ] */}
                <div
                  style={{
                    left: `${pillRightX}px`,
                    top: `${t.y}px`,
                  }}
                  className={`absolute -translate-x-full -translate-y-1/2 ${accentBg} text-white rounded-full pl-1 pr-1.5 py-0.5 flex items-center gap-1 shadow-md z-[3] font-mono tabular-nums`}
                >
                  <span className="w-3.5 h-3.5 rounded-full bg-black/20 flex items-center justify-center text-[9px] font-black leading-none shrink-0">
                    {isCall ? '↑' : '↓'}
                  </span>
                  <span className="text-[11px] font-extrabold leading-none whitespace-nowrap">
                    {formatMoney(t.amount, {
                      includeDecimals: false,
                      tradeDisplayCurrency: t.displayCurrency ?? currency,
                      tradeFxRateUsed: t.fxRateUsed ?? rate,
                    })}
                  </span>
                  <span className="text-[10px] font-bold leading-none bg-white/20 px-1.5 py-0.5 rounded-full whitespace-nowrap">
                    {timerLabel}
                  </span>
                </div>
              </React.Fragment>
            );
          })}
        </div>
      )}

      {/* 1.5-SECOND QUOTEX RESULT (P/L) CHART BADGE AT CANDLE & BOTTOM-LEFT RESULT CARD */}
      {recentTradeResult && (
        <>
          {resultBadgeCoords && (
            <div
              className="pointer-events-none absolute inset-y-0 left-0 lg:left-11 right-0 z-[22] overflow-hidden"
            >
              {/* Vertical green/red highlight line through settlement candle */}
              <div
                style={{ left: `${resultBadgeCoords.x}px` }}
                className={`absolute inset-y-0 w-[1px] ${
                  recentTradeResult.status === 'WON'
                    ? 'bg-[#22ab68]/60'
                    : recentTradeResult.status === 'DRAW'
                      ? 'bg-slate-400/50'
                      : 'bg-[#e34c3b]/60'
                }`}
              />

              {/* RESULT (P/L) Box anchored to the candle X & settlement price Y */}
              <div
                style={{
                  left: `${resultBadgeCoords.x}px`,
                  top: `${resultBadgeCoords.y}px`,
                }}
                className="pointer-events-auto absolute -translate-x-[calc(100%-12px)] -translate-y-1/2 flex items-stretch rounded-md shadow-2xl overflow-hidden"
              >
                <div
                  className={`relative pl-3 pr-6 py-2 min-w-[116px] flex flex-col justify-center ${
                    recentTradeResult.status === 'WON'
                      ? 'bg-[#22ab68]'
                      : recentTradeResult.status === 'DRAW'
                        ? 'bg-[#363d52]'
                        : 'bg-[#e34c3b]'
                  } text-white`}
                >
                  <button
                    type="button"
                    onClick={() => onDismissTradeResult?.()}
                    className="absolute top-1 right-1 w-4 h-4 rounded-sm bg-black/15 hover:bg-black/25 text-white/90 flex items-center justify-center text-[10px] font-bold leading-none cursor-pointer"
                  >
                    ×
                  </button>
                  <div className="text-[9px] font-extrabold uppercase tracking-wider text-white/95 leading-none">
                    RESULT (P/L)
                  </div>
                  <div className="text-sm font-black font-mono text-white leading-tight mt-1 tabular-nums whitespace-nowrap">
                    {recentTradeResult.status === 'WON' ||
                    recentTradeResult.status === 'DRAW'
                      ? formatMoney(recentTradeResult.totalPayout, {
                          showPlusSign: true,
                          tradeDisplayCurrency:
                            recentTradeResult.displayCurrency ?? currency,
                          tradeFxRateUsed:
                            recentTradeResult.fxRateUsed ?? rate,
                        })
                      : formatMoney(0, {
                          tradeDisplayCurrency:
                            recentTradeResult.displayCurrency ?? currency,
                          tradeFxRateUsed:
                            recentTradeResult.fxRateUsed ?? rate,
                        })}
                  </div>
                </div>

                {/* Right-side candle node strip */}
                <div
                  className={`w-6 flex items-center justify-center ${
                    recentTradeResult.status === 'WON'
                      ? 'bg-[#1e995d]'
                      : recentTradeResult.status === 'DRAW'
                        ? 'bg-[#2d3346]'
                        : 'bg-[#cc4131]'
                  }`}
                >
                  <span className="w-4 h-4 rounded-full bg-black/20 flex items-center justify-center text-[9px] font-mono font-bold text-white leading-none">
                    ()
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* Bottom-Left 1.5s Result Summary Card (Matches Screenshot 2) */}
          <div className="absolute left-3 lg:left-24 bottom-8 z-[22] bg-[#262b3c]/95 backdrop-blur-md border border-[#343b4f] rounded-lg px-3.5 py-2.5 min-w-[175px] shadow-2xl">
            <button
              type="button"
              onClick={() => onDismissTradeResult?.()}
              className="absolute top-1.5 right-1.5 w-4 h-4 text-[#8c94ab] hover:text-white flex items-center justify-center text-xs leading-none cursor-pointer"
            >
              ×
            </button>
            <div className="flex items-center gap-1.5 pr-4 text-xs">
              <div className="relative flex items-center w-5 h-3.5 shrink-0">
                <span className="w-3.5 h-3.5 rounded-full bg-[#1d4ed8] border border-white/40 flex items-center justify-center text-[7px] font-bold text-white">
                  {recentTradeResult.symbol.slice(0, 1)}
                </span>
                <span className="w-3.5 h-3.5 rounded-full bg-[#e34c3b] border border-white/40 flex items-center justify-center text-[7px] font-bold text-white -ml-1">
                  +
                </span>
              </div>
              <span className="font-bold text-white truncate max-w-[92px]">
                {recentTradeResult.symbol} (OTC)
              </span>
              <span className="text-[#8c94ab] font-mono text-[11px] tabular-nums shrink-0">
                · {recentTradeResult.durationLabel}
              </span>
            </div>
            <div
              className={`mt-1.5 font-mono font-extrabold text-sm tabular-nums ${
                recentTradeResult.status === 'WON'
                  ? 'text-[#22ab68]'
                  : recentTradeResult.status === 'DRAW'
                    ? 'text-slate-300'
                    : 'text-[#e34c3b]'
              }`}
            >
              {recentTradeResult.status === 'WON' ||
              recentTradeResult.status === 'DRAW'
                ? formatMoney(recentTradeResult.totalPayout, {
                    showPlusSign: true,
                    tradeDisplayCurrency:
                      recentTradeResult.displayCurrency ?? currency,
                    tradeFxRateUsed: recentTradeResult.fxRateUsed ?? rate,
                  })
                : formatMoney(0, {
                    tradeDisplayCurrency:
                      recentTradeResult.displayCurrency ?? currency,
                    tradeFxRateUsed: recentTradeResult.fxRateUsed ?? rate,
                  })}
            </div>
          </div>
        </>
      )}

      {/* Desktop Bottom-Left Chart Tool Controls (Timeframe button removed; hardcoded 30s candles) */}
      <div className="hidden lg:flex absolute left-14 bottom-8 z-[15] flex-col gap-1.5">
        <button
          type="button"
          onClick={() => chartRef.current?.timeScale().scrollToRealTime()}
          title="Reset Chart Position"
          className="w-8 h-8 rounded-lg bg-[#232837]/90 hover:bg-[#2d3346] text-slate-200 flex items-center justify-center cursor-pointer transition-colors"
        >
          <Pencil className="w-3.5 h-3.5" />
        </button>

        <button
          type="button"
          onClick={() => chartRef.current?.timeScale().fitContent()}
          title="Fit All Candles"
          className="w-8 h-8 rounded-lg bg-[#232837]/90 hover:bg-[#2d3346] text-slate-200 flex items-center justify-center cursor-pointer transition-colors"
        >
          <BarChart2 className="w-3.5 h-3.5" />
        </button>

        <button
          type="button"
          onClick={() => setPairInfoOpen(true)}
          title="Market Feed Specs"
          className="w-8 h-8 rounded-lg bg-[#232837]/90 hover:bg-[#2d3346] text-slate-200 flex items-center justify-center cursor-pointer transition-colors"
        >
          <Sliders className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Desktop Bottom-Center Zoom Controls */}
      <div className="hidden lg:flex absolute left-1/2 -translate-x-1/2 bottom-8 z-[15] items-center gap-1.5">
        <button
          type="button"
          onClick={() => handleZoom('out')}
          title="Zoom Out"
          className="w-7 h-7 rounded-lg bg-[#232837] hover:bg-[#2d3346] text-slate-300 flex items-center justify-center cursor-pointer"
        >
          <Minus className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          onClick={() => handleZoom('in')}
          title="Zoom In"
          className="w-7 h-7 rounded-lg bg-[#232837] hover:bg-[#2d3346] text-slate-300 flex items-center justify-center cursor-pointer"
        >
          <Plus className="w-3.5 h-3.5" />
        </button>
      </div>

      {pairInfoOpen && (
        <div className="fixed inset-0 z-[60] bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-[#1c202b] border border-[#2e3446] rounded-2xl p-5 text-slate-200">
            <div className="flex items-center justify-between pb-3 border-b border-[#262b38]">
              <h3 className="text-sm font-bold text-white">
                Instrument Specification · {symbol}
              </h3>
              <button
                type="button"
                onClick={() => setPairInfoOpen(false)}
                className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="py-4 space-y-2.5 text-xs">
              <div className="flex justify-between">
                <span className="text-[#8c94ab]">Latest Server Spot Price</span>
                <span className="font-mono font-bold text-white tabular-nums">
                  {latestServerPrice.toFixed(decimals)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#8c94ab]">Payout Percentage</span>
                <span className="font-mono font-bold text-[#22ab68] tabular-nums">
                  {payoutPercent}%
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#8c94ab]">Candle Interval</span>
                <span className="font-mono text-slate-200">
                  {CANDLE_INTERVAL_SECONDS}s (Clock-aligned :00 / :30)
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#8c94ab]">Feed Channel</span>
                <span className="font-mono text-[#22ab68] uppercase">
                  {streamStatus} (1s ticks + 60fps easing)
                </span>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setPairInfoOpen(false)}
              className="min-h-[44px] w-full py-2.5 bg-[#1d8cf8] hover:bg-[#1779db] text-white text-xs font-bold rounded-xl cursor-pointer"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
