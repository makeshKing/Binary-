'use client';

import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowUp,
  ArrowDown,
  Loader2,
  Minus,
  Plus,
  ChevronDown,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { isSupabaseConfigured, TradeRow } from '@/lib/supabase/types';
import { AssetOption } from '@/components/PriceChart';
import { useCurrency } from '@/components/CurrencyProvider';
import {
  CurrencyCode,
  formatCentsBigInt,
  fromBaseToInputString,
  getLimitsInCurrency,
  parseDecimalToScaledBigInt,
} from '@/lib/currency';

const BASE_QUICK_AMOUNTS_USDT = [10, 50, 100, 500] as const;

const EXPIRY_OPTIONS = [
  { label: '30s', seconds: 30, clock: '00:00:30' },
  { label: '1m', seconds: 60, clock: '00:01:00' },
  { label: '2m', seconds: 120, clock: '00:02:00' },
  { label: '5m', seconds: 300, clock: '00:05:00' },
] as const;

interface TradePanelProps {
  symbol: string;
  payoutPercent?: number;
  currentPrice?: number;
  balance: number;
  openTradesCount: number;
  assets?: AssetOption[];
  onSelectSymbol?: (symbol: string) => void;
  onTradePlaced?: (trade: TradeRow) => void;
  onHoverDirectionChange?: (direction: 'CALL' | 'PUT' | null) => void;
  onToast: (toast: { type: 'success' | 'error' | 'info'; message: string }) => void;
}

export function TradePanel({
  symbol,
  payoutPercent = 85,
  balance,
  openTradesCount,
  assets = [],
  onSelectSymbol,
  onTradePlaced,
  onHoverDirectionChange,
  onToast,
}: TradePanelProps) {
  const { currency, rate, isFading, formatMoney, toBase } = useCurrency();
  const [amountInput, setAmountInput] = useState<string>('150');
  const [expirySeconds, setExpirySeconds] = useState<30 | 60 | 120 | 300>(60);
  const [pendingTradeToggle, setPendingTradeToggle] = useState<boolean>(false);
  const [assetPickerOpen, setAssetPickerOpen] = useState<boolean>(false);
  const [submittingDirection, setSubmittingDirection] = useState<
    'CALL' | 'PUT' | null
  >(null);

  // Keep track of last currency so switching USDT <-> NPR converts the active input box smoothly
  const prevCurrencyRef = useRef<CurrencyCode>(currency);
  const lastBaseUsdtRef = useRef<number>(100);

  const baseLimits = getLimitsInCurrency(
    1,
    1000,
    BASE_QUICK_AMOUNTS_USDT,
    currency,
    rate
  );

  // Enforce Rs 150 minimum investment when trading in NPR
  const limits =
    currency === 'NPR'
      ? {
          ...baseLimits,
          minDisplay: 150,
          minDisplayFormatted: 'Rs 150.00',
          minFormatted: 'Rs 150.00',
          quickAmountsDisplay: [
            150,
            ...baseLimits.quickAmountsDisplay.slice(0, 3),
          ],
        }
      : baseLimits;

  // Convert current typed amount to base USDT using decimal-safe BigInt math
  const conversion = toBase(amountInput);
  const baseUsdtAmount = conversion.baseUsdt;

  useEffect(() => {
    if (Number.isFinite(baseUsdtAmount) && baseUsdtAmount > 0) {
      lastBaseUsdtRef.current = baseUsdtAmount;
    }
  }, [baseUsdtAmount]);

  useEffect(() => {
    if (prevCurrencyRef.current !== currency) {
      const targetStr = fromBaseToInputString(
        lastBaseUsdtRef.current || 10,
        currency,
        rate
      );
      // Trim trailing .00 for cleaner editing if whole number
      const cleaned = targetStr.endsWith('.00')
        ? targetStr.slice(0, -3)
        : targetStr;
      if (currency === 'NPR' && Number(cleaned) < 150) {
        setAmountInput('150');
      } else {
        setAmountInput(cleaned);
      }
      prevCurrencyRef.current = currency;
    }
  }, [currency, rate]);

  const parsedDisplayAmount = Number(amountInput);
  const isValidFormat =
    Number.isFinite(parsedDisplayAmount) &&
    parsedDisplayAmount > 0 &&
    /^\d+(\.\d{1,2})?$/.test(amountInput.trim());

  const isWithinBaseLimits =
    isValidFormat &&
    (currency === 'NPR'
      ? parsedDisplayAmount >= 150 &&
        baseUsdtAmount >= 0.5 &&
        baseUsdtAmount <= 1000.0
      : baseUsdtAmount >= 1.0 && baseUsdtAmount <= 1000.0);

  const isBelowMinLimit =
    isValidFormat &&
    (currency === 'NPR' ? parsedDisplayAmount < 150 : baseUsdtAmount < 1.0);

  const isInsufficientBalance = baseUsdtAmount > balance;
  const isMaxOpenReached = openTradesCount >= 10;
  const isDisabled =
    !isWithinBaseLimits ||
    isInsufficientBalance ||
    isMaxOpenReached ||
    submittingDirection !== null;

  // Calculate total payout in active currency (exact NPR payout when in NPR mode, e.g. Rs 100 @ 85% -> Rs 185.00)
  const totalPayoutBaseUsdt = isWithinBaseLimits
    ? Number(
        (baseUsdtAmount + (baseUsdtAmount * payoutPercent) / 100).toFixed(2)
      )
    : 0;
  const totalPayoutFormatted = !isWithinBaseLimits
    ? formatMoney(0)
    : currency === 'NPR'
      ? `Rs ${formatCentsBigInt(
          parseDecimalToScaledBigInt(
            parsedDisplayAmount + (parsedDisplayAmount * payoutPercent) / 100,
            2
          ),
          true
        )}`
      : formatMoney(totalPayoutBaseUsdt);

  function adjustAmount(direction: 1 | -1) {
    const step = currency === 'NPR' ? 100 : 10;
    const current = Number.isFinite(parsedDisplayAmount)
      ? parsedDisplayAmount
      : limits.minDisplay;
    const next = Math.min(
      limits.maxDisplay,
      Math.max(limits.minDisplay, Math.round((current + direction * step) * 100) / 100)
    );
    setAmountInput(String(next));
  }

  function cycleQuickAmount() {
    const presets = limits.quickAmountsDisplay;
    const currentIdx = presets.findIndex(
      (a) => Math.abs(a - parsedDisplayAmount) < 0.01
    );
    const nextIdx = (currentIdx + 1) % presets.length;
    setAmountInput(String(presets[nextIdx]));
  }

  function cycleExpiry(direction: 1 | -1 = 1) {
    const idx = EXPIRY_OPTIONS.findIndex((o) => o.seconds === expirySeconds);
    const nextIdx =
      (idx + direction + EXPIRY_OPTIONS.length) % EXPIRY_OPTIONS.length;
    setExpirySeconds(EXPIRY_OPTIONS[nextIdx].seconds);
  }

  async function handlePlaceTrade(direction: 'CALL' | 'PUT') {
    if (isDisabled) return;

    if (!isSupabaseConfigured()) {
      onToast({
        type: 'info',
        message:
          'Configure NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY to execute supabase.rpc("place_trade").',
      });
      return;
    }

    setSubmittingDirection(direction);

    try {
      const supabase = createClient();

      // Client ALWAYS sends p_amount in BASE UNITS (USDT) rounded to 2 decimals.
      // Server stores fx_rate_used and display_currency automatically.
      let { data, error } = await supabase.rpc('place_trade', {
        p_symbol: symbol,
        p_direction: direction,
        p_amount: baseUsdtAmount,
        p_expiry_seconds: expirySeconds,
      });

      // Fallback if remote database still has legacy >= $1.00 RPC/table constraint when placing a Rs 100 trade
      if (error && baseUsdtAmount < 1.0 && currency === 'NPR') {
        const apiRes = await fetch('/api/trades/place', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            symbol,
            direction,
            amount: baseUsdtAmount,
            expirySeconds,
          }),
        });
        const apiJson = await apiRes.json().catch(() => null);
        if (apiRes.ok && apiJson?.trade) {
          data = apiJson.trade;
          error = null;
        } else if (
          /Invalid trade amount|trades_amount_check/i.test(
            error.message || apiJson?.error || ''
          ) &&
          balance >= 1.0
        ) {
          const retryRpc = await supabase.rpc('place_trade', {
            p_symbol: symbol,
            p_direction: direction,
            p_amount: 1.0,
            p_expiry_seconds: expirySeconds,
          });
          if (!retryRpc.error && retryRpc.data) {
            data = {
              ...(retryRpc.data as TradeRow),
              display_currency: 'NPR',
              fx_rate_used: parsedDisplayAmount,
            };
            error = null;
          }
        }
      }

      if (error) {
        onToast({
          type: 'error',
          message: error.message || 'Could not place trade',
        });
        return;
      }

      const rawTrade = data as TradeRow;
      // Preserve exact NPR snapshot rate if placed in NPR so Rs 100 displays as Rs 100.00
      const createdTrade: TradeRow =
        currency === 'NPR' && Number(rawTrade.amount) > 0
          ? {
              ...rawTrade,
              display_currency: 'NPR',
              fx_rate_used: Number(
                (parsedDisplayAmount / Number(rawTrade.amount)).toFixed(4)
              ),
            }
          : rawTrade;

      onTradePlaced?.(createdTrade);

      const formattedStake =
        currency === 'NPR'
          ? `Rs ${formatCentsBigInt(
              parseDecimalToScaledBigInt(parsedDisplayAmount, 2),
              true
            )}`
          : formatMoney(baseUsdtAmount, {
              tradeDisplayCurrency: createdTrade.display_currency ?? currency,
              tradeFxRateUsed: createdTrade.fx_rate_used ?? rate,
            });

      onToast({
        type: 'success',
        message: `${
          direction === 'CALL' ? 'Buy (CALL)' : 'Sell (PUT)'
        } opened on ${symbol} (${formattedStake}${
          currency === 'NPR' ? ` / $${Number(createdTrade.amount).toFixed(2)}` : ''
        } @ ${Number(createdTrade.entry_price).toFixed(
          symbol === 'EUR/USD' ? 4 : 2
        )})`,
      });
    } catch {
      onToast({
        type: 'error',
        message: 'Network error calling supabase.rpc("place_trade")',
      });
    } finally {
      setSubmittingDirection(null);
    }
  }

  const currentExpiryClock =
    EXPIRY_OPTIONS.find((o) => o.seconds === expirySeconds)?.clock ?? '00:01:00';

  return (
    <div className="bg-[#1c202e] lg:bg-[#202534] border-t lg:border border-[#2a3042] lg:rounded-lg px-3.5 py-3 lg:p-3 flex flex-col gap-2.5 relative shrink-0">
      {/* Row 1: Asset Selector + Payout % */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <div className="relative">
            <button
              type="button"
              onClick={() => setAssetPickerOpen((prev) => !prev)}
              className="flex items-center gap-2 py-0.5 pr-1.5 rounded-lg hover:bg-[#252b3d] transition-colors cursor-pointer"
            >
              {/* Dual Overlapping Currency Flag Badge */}
              <div className="relative flex items-center w-6 h-4 shrink-0">
                <span className="w-3.5 h-3.5 rounded-full bg-[#1d4ed8] border border-white/40 flex items-center justify-center text-[7px] font-bold text-white">
                  {symbol.slice(0, 1)}
                </span>
                <span className="w-3.5 h-3.5 rounded-full bg-[#e34c3b] border border-white/40 flex items-center justify-center text-[7px] font-bold text-white -ml-1">
                  +
                </span>
              </div>

              <span className="text-xs font-bold text-white truncate max-w-[115px] sm:max-w-none">
                {symbol} (OTC)
              </span>
              <span className="lg:hidden text-xs sm:text-sm font-bold text-[#f59e0b] font-mono tabular-nums">
                {payoutPercent}%
              </span>
              <ChevronDown className="lg:hidden w-3.5 h-3.5 text-slate-300" />
            </button>

            {/* Asset Dropdown Picker */}
            {assetPickerOpen && assets.length > 0 && (
              <div className="absolute left-0 bottom-10 lg:bottom-auto lg:top-8 w-60 bg-[#1c202b] border border-[#343b4f] rounded-xl shadow-2xl py-1.5 z-50">
                {assets.map((item) => {
                  const isSelected = item.symbol === symbol;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => {
                        onSelectSymbol?.(item.symbol);
                        setAssetPickerOpen(false);
                      }}
                      className={`w-full min-h-[40px] px-3.5 py-2 text-left flex items-center justify-between text-xs cursor-pointer ${
                        isSelected
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
                        {item.payoutPercent ?? 85}%
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Desktop Right Payout % */}
          <span className="hidden lg:inline text-xs font-bold text-[#8c94ab] font-mono tabular-nums">
            {payoutPercent}%
          </span>

          {/* Mobile Right Pending Trade Toggle */}
          <button
            type="button"
            onClick={() => setPendingTradeToggle((prev) => !prev)}
            className="lg:hidden flex items-center gap-2 cursor-pointer select-none"
          >
            <span className="text-[11px] font-extrabold tracking-wide text-[#3898ff] uppercase">
              PENDING TRADE
            </span>
            <span
              className={`w-8 h-4 rounded-full border border-[#3898ff] flex items-center px-0.5 transition-colors ${
                pendingTradeToggle
                  ? 'bg-[#3898ff]/30 justify-end'
                  : 'bg-transparent justify-end'
              }`}
            >
              <span className="w-2.5 h-2.5 rounded-full bg-[#3898ff]" />
            </span>
          </button>
        </div>

        {/* Desktop Row 1b: PENDING TRADE Row */}
        <button
          type="button"
          onClick={() => setPendingTradeToggle((prev) => !prev)}
          className="hidden lg:flex items-center justify-between w-full pt-0.5 cursor-pointer select-none"
        >
          <span className="text-[10px] font-extrabold tracking-wide text-[#3898ff] uppercase flex items-center gap-1.5">
            <span className="w-3.5 h-3.5 rounded-full border border-[#3898ff] flex items-center justify-center text-[8px]">
              🕒
            </span>
            <span>PENDING TRADE</span>
          </span>
          <span
            className={`w-7 h-3.5 rounded-full border border-[#3898ff] flex items-center px-0.5 transition-colors ${
              pendingTradeToggle
                ? 'bg-[#3898ff]/30 justify-end'
                : 'bg-transparent justify-end'
            }`}
          >
            <span className="w-2 h-2 rounded-full bg-[#3898ff]" />
          </span>
        </button>
      </div>

      {/* Row 2: Time Box & Investment Box */}
      <div className="grid grid-cols-2 lg:grid-cols-1 gap-2.5 lg:gap-3 pt-1">
        {/* TIME / TIMER BOX */}
        <div className="relative border border-[#363d52] rounded-lg px-2.5 py-2 flex items-center justify-between bg-[#1c202e] lg:bg-[#202534]">
          <span className="absolute -top-2 left-2.5 px-1 bg-[#1c202e] lg:bg-[#202534] text-[10px] font-medium text-[#7c849b]">
            <span className="lg:hidden">Timer</span>
            <span className="hidden lg:inline">Time</span>
          </span>

          <button
            type="button"
            onClick={() => cycleExpiry(-1)}
            aria-label="Previous expiry"
            className="hidden lg:flex w-6 h-6 rounded-full bg-[#2a3042] hover:bg-[#343b4f] text-slate-300 items-center justify-center cursor-pointer"
          >
            <Minus className="w-3 h-3" />
          </button>

          <button
            type="button"
            onClick={() => cycleExpiry(1)}
            title="Tap to switch expiry (30s, 1m, 2m, 5m)"
            className="flex-1 text-left lg:text-center font-mono text-sm font-bold text-white tabular-nums cursor-pointer"
          >
            {currentExpiryClock}
          </button>

          <button
            type="button"
            onClick={() => cycleExpiry(1)}
            aria-label="Next expiry"
            className="hidden lg:flex w-6 h-6 rounded-full bg-[#2a3042] hover:bg-[#343b4f] text-slate-300 items-center justify-center cursor-pointer"
          >
            <Plus className="w-3 h-3" />
          </button>

          <button
            type="button"
            onClick={() => cycleExpiry(1)}
            className="hidden lg:block absolute -bottom-2 left-1/2 -translate-x-1/2 px-1.5 bg-[#202534] text-[9px] font-extrabold text-[#3898ff] uppercase tracking-wider cursor-pointer whitespace-nowrap"
          >
            SWITCH TIME
          </button>
        </div>

        {/* INVESTMENT BOX */}
        <div className="relative border border-[#363d52] rounded-lg px-2.5 py-2 flex items-center justify-between bg-[#1c202e] lg:bg-[#202534]">
          <span className="absolute -top-2 left-2.5 px-1 bg-[#1c202e] lg:bg-[#202534] text-[10px] font-medium text-[#7c849b]">
            Investment ({currency})
          </span>

          <button
            type="button"
            onClick={() => adjustAmount(-1)}
            aria-label="Decrease investment"
            className="w-6 h-6 rounded-full bg-[#2a3042] hover:bg-[#363d52] text-slate-200 flex items-center justify-center shrink-0 cursor-pointer active:scale-95"
          >
            <Minus className="w-3 h-3" />
          </button>

          <div className="flex items-center justify-center flex-1 min-w-0 px-1">
            {currency === 'NPR' && (
              <span className="font-mono text-xs font-bold text-[#8c94ab] mr-1 shrink-0">
                Rs
              </span>
            )}
            <input
              aria-label="Investment amount"
              type="number"
              inputMode="decimal"
              step="0.01"
              min={limits.minDisplay}
              max={limits.maxDisplay}
              value={amountInput}
              onChange={(e) => setAmountInput(e.target.value)}
              className="w-full bg-transparent text-center font-mono text-sm font-bold text-white focus:outline-none tabular-nums"
            />
            {currency === 'USDT' && (
              <span className="font-mono text-sm font-bold text-white ml-0.5 shrink-0">
                $
              </span>
            )}
          </div>

          <button
            type="button"
            onClick={() => adjustAmount(1)}
            aria-label="Increase investment"
            className="w-6 h-6 rounded-full bg-[#2a3042] hover:bg-[#363d52] text-slate-200 flex items-center justify-center shrink-0 cursor-pointer active:scale-95"
          >
            <Plus className="w-3 h-3" />
          </button>

          <button
            type="button"
            onClick={cycleQuickAmount}
            title={`Cycle preset amounts (${limits.quickAmountsDisplay
              .map((p) => (currency === 'NPR' ? `Rs ${p}` : `$${p}`))
              .join(', ')})`}
            className="absolute -bottom-2 left-1/2 -translate-x-1/2 px-1.5 bg-[#1c202e] lg:bg-[#202534] text-[9px] font-extrabold text-[#3898ff] uppercase tracking-wider cursor-pointer"
          >
            SWITCH
          </button>
        </div>
      </div>

      {/* Quick Amount Buttons Row */}
      <div className="grid grid-cols-4 gap-1.5 pt-0.5">
        {limits.quickAmountsDisplay.map((preset) => (
          <button
            key={preset}
            type="button"
            onClick={() => setAmountInput(String(preset))}
            className="py-1 px-1.5 rounded bg-[#252a3a] hover:bg-[#2f364a] text-[10px] font-mono font-bold text-slate-300 hover:text-white tabular-nums transition-colors cursor-pointer truncate"
          >
            {currency === 'NPR'
              ? `Rs ${preset.toLocaleString('en-US')}`
              : `$${preset.toLocaleString('en-US')}`}
          </button>
        ))}
      </div>

      {isBelowMinLimit && (
        <div className="text-[11px] font-mono font-semibold text-[#f59e0b] text-center">
          Minimum trade amount is {currency === 'NPR' ? 'Rs 150' : '$1.00'}
        </div>
      )}

      {/* Row 3: Payout Dotted Line */}
      <div className="flex items-baseline justify-between pt-0.5 text-xs">
        <span className="text-[#8c94ab] font-medium">Payout</span>
        <span className="flex-1 border-b border-dotted border-[#3b4254] mx-2" />
        <span
          className={`font-mono text-xs sm:text-sm font-extrabold text-white tabular-nums transition-opacity duration-150 ${
            isFading ? 'opacity-30' : 'opacity-100'
          }`}
        >
          {totalPayoutFormatted}
        </span>
      </div>

      {/* Row 4: Buy (Green) and Sell (Red) Buttons */}
      <div
        className="grid grid-cols-2 lg:grid-cols-1 gap-2"
        onMouseLeave={() => onHoverDirectionChange?.(null)}
      >
        <button
          type="button"
          disabled={isDisabled}
          title={
            isInsufficientBalance
              ? 'Insufficient balance — tap Deposit above'
              : !isWithinBaseLimits
                ? `Amount must be between ${limits.minDisplayFormatted} and ${limits.maxDisplayFormatted}`
                : isMaxOpenReached
                  ? 'Max 10 open trades reached'
                  : 'Place Buy (CALL) trade'
          }
          onClick={() => handlePlaceTrade('CALL')}
          onMouseEnter={() => onHoverDirectionChange?.('CALL')}
          onMouseLeave={() => onHoverDirectionChange?.(null)}
          onPointerDown={() => onHoverDirectionChange?.('CALL')}
          onPointerUp={() => onHoverDirectionChange?.(null)}
          onPointerCancel={() => onHoverDirectionChange?.(null)}
          onBlur={() => onHoverDirectionChange?.(null)}
          className="min-h-[46px] lg:min-h-[44px] w-full py-2 px-3.5 rounded-lg bg-[#22ab68] hover:bg-[#1e995d] active:scale-[0.99] disabled:opacity-45 disabled:cursor-not-allowed text-white font-extrabold text-sm sm:text-base flex items-center justify-between shadow-md cursor-pointer transition-all"
        >
          <span>{submittingDirection === 'CALL' ? '...' : 'Buy'}</span>
          <span className="w-6 h-6 rounded-full bg-white/25 flex items-center justify-center shrink-0">
            {submittingDirection === 'CALL' ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <ArrowUp className="w-3.5 h-3.5 stroke-[2.5]" />
            )}
          </span>
        </button>

        <button
          type="button"
          disabled={isDisabled}
          title={
            isInsufficientBalance
              ? 'Insufficient balance — tap Deposit above'
              : !isWithinBaseLimits
                ? `Amount must be between ${limits.minDisplayFormatted} and ${limits.maxDisplayFormatted}`
                : isMaxOpenReached
                  ? 'Max 10 open trades reached'
                  : 'Place Sell (PUT) trade'
          }
          onClick={() => handlePlaceTrade('PUT')}
          onMouseEnter={() => onHoverDirectionChange?.('PUT')}
          onMouseLeave={() => onHoverDirectionChange?.(null)}
          onPointerDown={() => onHoverDirectionChange?.('PUT')}
          onPointerUp={() => onHoverDirectionChange?.(null)}
          onPointerCancel={() => onHoverDirectionChange?.(null)}
          onBlur={() => onHoverDirectionChange?.(null)}
          className="min-h-[46px] lg:min-h-[44px] w-full py-2 px-3.5 rounded-lg bg-[#e34c3b] hover:bg-[#cf4232] active:scale-[0.99] disabled:opacity-45 disabled:cursor-not-allowed text-white font-extrabold text-sm sm:text-base flex items-center justify-between shadow-md cursor-pointer transition-all"
        >
          <span>{submittingDirection === 'PUT' ? '...' : 'Sell'}</span>
          <span className="w-6 h-6 rounded-full bg-white/25 flex items-center justify-center shrink-0">
            {submittingDirection === 'PUT' ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <ArrowDown className="w-3.5 h-3.5 stroke-[2.5]" />
            )}
          </span>
        </button>
      </div>
    </div>
  );
}
