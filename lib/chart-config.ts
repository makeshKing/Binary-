/**
 * Shared chart configuration constants.
 * Single source of truth for the 30-second candle interval, history depth,
 * tab-visibility resync window, tick retention, and animation easing.
 */

export const CANDLE_INTERVAL_SECONDS = 30;

// ~100 candles of 30s each = 3,000 seconds (~50 minutes of history on load)
export const TARGET_HISTORY_CANDLES = 100;

// Maximum candles retained in client memory
export const MAX_CANDLES_IN_MEMORY = 500;

// Reload the last ~5 minutes (300s) of ticks when returning to a hidden tab
export const RESYNC_WINDOW_SECONDS = 300;

// Database tick retention is at least 2 hours (120 minutes > 50 minutes needed for 100 candles)
export const TICK_RETENTION_HOURS = 2;

// Per-frame linear interpolation factor for requestAnimationFrame candle easing
export const CANDLE_EASING_FACTOR = 0.2;

// Snap immediately (no animation) if |targetPrice - displayedPrice| exceeds 3x normal per-tick move
export const SNAP_GAP_MULTIPLIER = 3;

// Maximum fraction of a normal 1-second tick move allowed in a single animation frame
export const MAX_FRAME_STEP_RATIO = 0.25;

// Safety guard: warn and clamp if a candle's range exceeds 5x the median range of the last 20 candles
export const ABNORMAL_RANGE_MEDIAN_MULTIPLIER = 5;
export const MEDIAN_RANGE_LOOKBACK_CANDLES = 20;
