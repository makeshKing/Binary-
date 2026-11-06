'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  History,
  ChevronLeft,
  ChevronRight,
  ArrowUp,
  ArrowDown,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { isSupabaseConfigured, TradeRow } from '@/lib/supabase/types';
import { useCurrency } from '@/components/CurrencyProvider';
import { CurrencyCode } from '@/lib/currency';

export interface ClosedTradeRecord {
  id: string;
  symbol: string;
  direction: 'CALL' | 'PUT';
  amount: string;
  amountNumber: number;
  entryPrice: string;
  entryPriceNumber: number;
  exitPrice: string | null;
  exitPriceNumber: number | null;
  payoutPercent: number;
  openedAt: string;
  expiresAt: string;
  status: 'WON' | 'LOST' | 'DRAW';
  profit: string | null;
  profitNumber: number | null;
  displayCurrency?: CurrencyCode | null;
  fxRateUsed?: number | null;
}

interface TradeHistoryProps {
  userId?: string | null;
  assetSymbolById: Record<string, string>;
  refreshTrigger: number;
}

export function TradeHistory({
  userId,
  assetSymbolById,
  refreshTrigger,
}: TradeHistoryProps) {
  const { formatMoney, isFading, rate } = useCurrency();
  const [page, setPage] = useState<number>(1);
  const [trades, setTrades] = useState<ClosedTradeRecord[]>([]);
  const [total, setTotal] = useState<number>(0);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const limit = 8;

  const totalPages = Math.max(1, Math.ceil(total / limit));

  const fetchClosedTrades = useCallback(async () => {
    if (!isSupabaseConfigured() || !userId) {
      setTrades([]);
      setTotal(0);
      return;
    }

    setIsLoading(true);
    try {
      const supabase = createClient();
      const from = (page - 1) * limit;
      const to = from + limit - 1;

      const { data, count, error } = await supabase
        .from('trades')
        .select('*', { count: 'exact' })
        .eq('user_id', userId)
        .in('status', ['WON', 'LOST', 'DRAW'])
        .order('expires_at', { ascending: false })
        .range(from, to);

      if (error || !data) return;

      const mapped: ClosedTradeRecord[] = (data as TradeRow[]).map((row) => {
        const sym = assetSymbolById[row.asset_id] || 'BTC/USD';
        const amountNum = Number(row.amount);
        const entryNum = Number(row.entry_price);
        const exitNum =
          row.exit_price !== null ? Number(row.exit_price) : null;
        const profitNum = row.profit !== null ? Number(row.profit) : null;

        return {
          id: row.id,
          symbol: sym,
          direction: row.direction,
          amount: amountNum.toFixed(2),
          amountNumber: amountNum,
          entryPrice: String(row.entry_price),
          entryPriceNumber: entryNum,
          exitPrice: row.exit_price !== null ? String(row.exit_price) : null,
          exitPriceNumber: exitNum,
          payoutPercent: row.payout_percent,
          openedAt: row.opened_at,
          expiresAt: row.expires_at,
          status: row.status as 'WON' | 'LOST' | 'DRAW',
          profit: profitNum !== null ? profitNum.toFixed(2) : null,
          profitNumber: profitNum,
          displayCurrency:
            row.display_currency === 'NPR' || row.display_currency === 'USDT'
              ? row.display_currency
              : 'USDT',
          fxRateUsed:
            row.fx_rate_used !== null && row.fx_rate_used !== undefined
              ? Number(row.fx_rate_used)
              : null,
        };
      });

      setTrades(mapped);
      setTotal(count ?? mapped.length);
    } finally {
      setIsLoading(false);
    }
  }, [userId, page, assetSymbolById]);

  useEffect(() => {
    fetchClosedTrades();
  }, [fetchClosedTrades, refreshTrigger]);

  return (
    <div className="bg-[#232837] border border-[#2e3446] rounded-xl overflow-hidden">
      <div className="px-3.5 sm:px-4 py-2.5 border-b border-[#2e3446] flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <History className="w-3.5 h-3.5 text-[#3898ff] shrink-0" />
          <h3 className="text-xs font-bold text-white truncate">
            Settled Trade History ({total})
          </h3>
        </div>

        <div className="flex items-center gap-1.5 text-xs shrink-0">
          <span className="text-[#8c94ab] font-mono tabular-nums text-[11px]">
            {page}/{totalPages}
          </span>
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            className="min-w-[36px] min-h-[36px] sm:min-w-[32px] sm:min-h-[32px] flex items-center justify-center rounded-lg bg-[#1c202b] border border-[#343b4f] text-slate-300 disabled:opacity-40 cursor-pointer"
            aria-label="Previous page"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button
            type="button"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            className="min-w-[36px] min-h-[36px] sm:min-w-[32px] sm:min-h-[32px] flex items-center justify-center rounded-lg bg-[#1c202b] border border-[#343b4f] text-slate-300 disabled:opacity-40 cursor-pointer"
            aria-label="Next page"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Mobile-First Card List (< 640px) */}
      <div className="sm:hidden divide-y divide-[#2e3446]/70">
        {isLoading && trades.length === 0 ? (
          <div className="py-6 px-4 text-center text-xs text-[#7c849b]">
            Loading settled trades from Supabase...
          </div>
        ) : trades.length === 0 ? (
          <div className="py-6 px-4 text-center text-xs text-[#7c849b]">
            No settled trades yet.
          </div>
        ) : (
          trades.map((trade) => {
            const dec = trade.symbol === 'EUR/USD' ? 4 : 2;
            const profitNum = trade.profitNumber ?? 0;
            const origCur = trade.displayCurrency || 'USDT';
            const origRate = trade.fxRateUsed ?? rate ?? 134.5;

            const formattedAmount = formatMoney(trade.amountNumber, {
              tradeDisplayCurrency: origCur,
              tradeFxRateUsed: origRate,
            });
            const formattedProfit = formatMoney(profitNum, {
              showPlusSign: profitNum > 0,
              tradeDisplayCurrency: origCur,
              tradeFxRateUsed: origRate,
            });

            return (
              <div
                key={trade.id}
                title={`Placed in ${origCur} @ Rs ${Number(origRate).toFixed(
                  2
                )} · Base: $${trade.amount}`}
                className="p-3.5 space-y-2 text-xs"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span
                      className={`px-2 py-0.5 rounded font-mono font-bold text-[11px] flex items-center gap-0.5 ${
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
                      {formattedAmount}
                    </span>
                  </div>

                  <div
                    className={`flex items-center gap-2 font-mono font-bold tabular-nums transition-opacity duration-150 ${
                      isFading ? 'opacity-30' : 'opacity-100'
                    }`}
                  >
                    <span
                      className={
                        trade.status === 'WON'
                          ? 'text-[#22ab68]'
                          : trade.status === 'LOST'
                            ? 'text-[#e34c3b]'
                            : 'text-slate-400'
                      }
                    >
                      {trade.status}
                    </span>
                    <span>·</span>
                    <span
                      className={
                        profitNum > 0
                          ? 'text-[#22ab68]'
                          : profitNum < 0
                            ? 'text-[#e34c3b]'
                            : 'text-slate-400'
                      }
                    >
                      {formattedProfit}
                    </span>
                  </div>
                </div>

                <div className="flex items-center justify-between text-[11px] font-mono text-[#8c94ab] tabular-nums">
                  <span>
                    {trade.entryPriceNumber.toFixed(dec)} →{' '}
                    {trade.exitPriceNumber !== null
                      ? trade.exitPriceNumber.toFixed(dec)
                      : '—'}{' '}
                    · {origCur} @ {Number(origRate).toFixed(2)}
                  </span>
                  <span>
                    {new Date(trade.expiresAt).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                      second: '2-digit',
                    })}
                  </span>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Tablet & Desktop Full Data Table (sm:block) */}
      <div className="hidden sm:block overflow-x-auto">
        <table className="w-full text-left border-collapse text-xs">
          <thead>
            <tr className="border-b border-[#2e3446] bg-[#1c202b]/60 text-[11px] font-semibold text-[#8c94ab]">
              <th className="py-2.5 px-4">Asset</th>
              <th className="py-2.5 px-3">Direction</th>
              <th className="py-2.5 px-3 text-right">Amount</th>
              <th className="py-2.5 px-3 text-right">FX Snapshot</th>
              <th className="py-2.5 px-3 text-right">Entry / Exit</th>
              <th className="py-2.5 px-3">Result</th>
              <th className="py-2.5 px-3 text-right">Profit</th>
              <th className="py-2.5 px-4 text-right">Settled Time</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#2e3446]/60">
            {isLoading && trades.length === 0 ? (
              <tr>
                <td colSpan={8} className="py-6 text-center text-[#7c849b]">
                  Loading settled trades from Supabase...
                </td>
              </tr>
            ) : trades.length === 0 ? (
              <tr>
                <td colSpan={8} className="py-6 text-center text-[#7c849b]">
                  No settled trades yet.
                </td>
              </tr>
            ) : (
              trades.map((trade) => {
                const dec = trade.symbol === 'EUR/USD' ? 4 : 2;
                const profitNum = trade.profitNumber ?? 0;
                const origCur = trade.displayCurrency || 'USDT';
                const origRate = trade.fxRateUsed ?? rate ?? 134.5;

                const formattedAmount = formatMoney(trade.amountNumber, {
                  tradeDisplayCurrency: origCur,
                  tradeFxRateUsed: origRate,
                });
                const formattedProfit = formatMoney(profitNum, {
                  showPlusSign: profitNum > 0,
                  tradeDisplayCurrency: origCur,
                  tradeFxRateUsed: origRate,
                });

                return (
                  <tr
                    key={trade.id}
                    title={`Placed in ${origCur} · FX rate snapshot: 1 USDT = Rs ${Number(
                      origRate
                    ).toFixed(2)} · Base: $${trade.amount}`}
                    className="hover:bg-[#1c202b]/50 transition-colors"
                  >
                    <td className="py-2.5 px-4 font-bold text-white">
                      {trade.symbol}
                    </td>
                    <td className="py-2.5 px-3 font-mono font-bold">
                      <span
                        className={
                          trade.direction === 'CALL'
                            ? 'text-[#22ab68]'
                            : 'text-[#e34c3b]'
                        }
                      >
                        {trade.direction}
                      </span>
                    </td>
                    <td
                      className={`py-2.5 px-3 text-right font-mono text-slate-200 tabular-nums transition-opacity duration-150 ${
                        isFading ? 'opacity-30' : 'opacity-100'
                      }`}
                    >
                      <div>{formattedAmount}</div>
                      <div className="text-[10px] text-[#7c849b]">
                        Base: ${trade.amount}
                      </div>
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono text-[11px] text-[#8c94ab] tabular-nums">
                      {origCur} @ {Number(origRate).toFixed(2)}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono text-slate-300 tabular-nums">
                      {trade.entryPriceNumber.toFixed(dec)} →{' '}
                      {trade.exitPriceNumber !== null
                        ? trade.exitPriceNumber.toFixed(dec)
                        : '—'}
                    </td>
                    <td className="py-2.5 px-3 font-mono font-bold">
                      {trade.status === 'WON' ? (
                        <span className="text-[#22ab68]">WON</span>
                      ) : trade.status === 'LOST' ? (
                        <span className="text-[#e34c3b]">LOST</span>
                      ) : (
                        <span className="text-slate-400">DRAW</span>
                      )}
                    </td>
                    <td
                      className={`py-2.5 px-3 text-right font-mono font-bold tabular-nums transition-opacity duration-150 ${
                        isFading ? 'opacity-30' : 'opacity-100'
                      }`}
                    >
                      <span
                        className={
                          profitNum > 0
                            ? 'text-[#22ab68]'
                            : profitNum < 0
                              ? 'text-[#e34c3b]'
                              : 'text-slate-400'
                        }
                      >
                        {formattedProfit}
                      </span>
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono text-[#8c94ab] tabular-nums">
                      {new Date(trade.expiresAt).toLocaleTimeString()}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
