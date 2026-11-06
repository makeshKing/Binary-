'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Clock, ArrowUp, ArrowDown } from 'lucide-react';
import { useCurrency } from '@/components/CurrencyProvider';
import { CurrencyCode } from '@/lib/currency';

export interface OpenTradeItem {
  id: string;
  assetId: string;
  symbol: string;
  direction: 'CALL' | 'PUT';
  amount: string;
  amountNumber: number;
  entryPrice: string;
  entryPriceNumber: number;
  payoutPercent: number;
  openedAt: string;
  expiresAt: string;
  status: 'OPEN';
  displayCurrency?: CurrencyCode | null;
  fxRateUsed?: number | null;
}

interface OpenTradesProps {
  openTrades: OpenTradeItem[];
  livePrices: Record<string, number>;
}

export function OpenTrades({ openTrades, livePrices }: OpenTradesProps) {
  const { formatMoney, isFading, rate } = useCurrency();
  const [nowMs, setNowMs] = useState<number>(0);
  const mountedRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    setNowMs(Date.now());
    const timer = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="bg-[#232837] border border-[#2e3446] rounded-xl overflow-hidden">
      <div className="px-4 py-2.5 border-b border-[#2e3446] flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Clock className="w-3.5 h-3.5 text-[#3898ff]" />
          <h3 className="text-xs font-bold text-white">
            Open Positions ({openTrades.length}/10)
          </h3>
        </div>
        <span className="text-[11px] text-[#8c94ab]">
          Realtime via public.trades
        </span>
      </div>

      {openTrades.length === 0 ? (
        <div className="py-6 px-4 text-center text-xs text-[#7c849b]">
          No active open trades. Choose an expiry and tap CALL or PUT to open a
          position via{' '}
          <code className="font-mono text-slate-300">place_trade()</code>.
        </div>
      ) : (
        <div className="divide-y divide-[#2e3446] max-h-56 overflow-y-auto">
          {openTrades.map((trade) => {
            const effectiveNow =
              nowMs > 0 ? nowMs : new Date(trade.openedAt).getTime();
            const remainingSec = Math.max(
              0,
              Math.ceil(
                (new Date(trade.expiresAt).getTime() - effectiveNow) / 1000
              )
            );
            const mins = Math.floor(remainingSec / 60);
            const secs = remainingSec % 60;
            const timerStr = `${String(mins).padStart(2, '0')}:${String(
              secs
            ).padStart(2, '0')}`;

            const currentSpot =
              livePrices[trade.symbol] ?? trade.entryPriceNumber;
            const decimals = trade.symbol === 'EUR/USD' ? 4 : 2;

            const isWinning =
              (trade.direction === 'CALL' &&
                currentSpot > trade.entryPriceNumber) ||
              (trade.direction === 'PUT' &&
                currentSpot < trade.entryPriceNumber);
            const isDraw = currentSpot === trade.entryPriceNumber;

            const expectedReturnBase = Number(
              (
                trade.amountNumber +
                (trade.amountNumber * trade.payoutPercent) / 100
              ).toFixed(2)
            );

            const origCur = trade.displayCurrency || 'USDT';
            const origRate = trade.fxRateUsed ?? rate ?? 134.5;
            const snapshotTooltip = `Placed in ${origCur} · FX rate snapshot: 1 USDT = Rs ${Number(
              origRate
            ).toFixed(2)} · Base stake: $${trade.amountNumber.toFixed(2)}`;

            const formattedStake = formatMoney(trade.amountNumber, {
              tradeDisplayCurrency: origCur,
              tradeFxRateUsed: origRate,
            });
            const formattedExpectedReturn = formatMoney(expectedReturnBase, {
              showPlusSign: true,
              tradeDisplayCurrency: origCur,
              tradeFxRateUsed: origRate,
            });
            const formattedDrawReturn = formatMoney(trade.amountNumber, {
              showPlusSign: true,
              tradeDisplayCurrency: origCur,
              tradeFxRateUsed: origRate,
            });
            const formattedZero = formatMoney(0, {
              tradeDisplayCurrency: origCur,
              tradeFxRateUsed: origRate,
            });

            return (
              <div
                key={trade.id}
                title={snapshotTooltip}
                className="px-4 py-2.5 flex flex-wrap items-center justify-between gap-3 text-xs hover:bg-[#1c202b]/60 transition-colors"
              >
                <div className="flex items-center gap-2.5">
                  <span
                    className={`px-2 py-0.5 rounded font-mono font-bold text-[11px] flex items-center gap-1 ${
                      trade.direction === 'CALL'
                        ? 'bg-[#22ab68]/20 text-[#22ab68]'
                        : 'bg-[#e34c3b]/20 text-[#e34c3b]'
                    }`}
                  >
                    {trade.direction === 'CALL' ? (
                      <ArrowUp className="w-3 h-3" />
                    ) : (
                      <ArrowDown className="w-3 h-3" />
                    )}
                    {trade.direction}
                  </span>
                  <span className="font-bold text-white">{trade.symbol}</span>
                  <span
                    className={`font-mono text-slate-300 tabular-nums transition-opacity duration-150 ${
                      isFading ? 'opacity-30' : 'opacity-100'
                    }`}
                  >
                    {formattedStake}
                  </span>
                  <span className="text-[10px] font-mono text-[#7c849b] tabular-nums">
                    ({origCur} @ {Number(origRate).toFixed(2)})
                  </span>
                </div>

                <div className="flex items-center gap-4 font-mono tabular-nums">
                  <div className="text-[#8c94ab]">
                    Entry:{' '}
                    <strong className="text-slate-200">
                      {trade.entryPriceNumber.toFixed(decimals)}
                    </strong>
                  </div>
                  <div className="text-[#8c94ab]">
                    Now:{' '}
                    <strong className="text-white">
                      {currentSpot.toFixed(decimals)}
                    </strong>
                  </div>
                  <span
                    className={`font-bold transition-opacity duration-150 ${
                      isFading ? 'opacity-30' : 'opacity-100'
                    } ${
                      isDraw
                        ? 'text-slate-400'
                        : isWinning
                          ? 'text-[#22ab68]'
                          : 'text-[#e34c3b]'
                    }`}
                  >
                    {isWinning
                      ? formattedExpectedReturn
                      : isDraw
                        ? formattedDrawReturn
                        : formattedZero}
                  </span>
                  <span className="px-2 py-0.5 rounded bg-[#1c202b] border border-[#343b4f] text-white font-bold">
                    {timerStr}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
