'use client';

import React from 'react';
import Link from 'next/link';
import { Trophy, ArrowLeft, BarChart3, LogOut } from 'lucide-react';
import {
  CurrencyToggleButton,
  useCurrency,
} from '@/components/CurrencyProvider';

export interface LeaderboardDisplayItem {
  rank: number;
  userId: string;
  name: string;
  tradesCount: number;
  totalVolumeNum: number;
  totalProfitNum: number;
  currentBalanceNum: number;
}

export function LeaderboardClientView({
  rows,
}: {
  rows: LeaderboardDisplayItem[];
}) {
  const { currency, rate, isFading, formatMoney } = useCurrency();

  return (
    <div className="min-h-screen bg-[#171a23] text-slate-100 flex flex-col">
      <header className="h-12 sm:h-14 bg-[#1c202b] border-b border-[#262b38] px-3 sm:px-6 flex items-center justify-between gap-4 sticky top-0 z-30">
        <Link href="/dashboard" className="flex items-center gap-2 shrink-0">
          <div className="w-7 h-7 rounded-lg bg-[#252a3a] border border-[#343b4f] flex items-center justify-center">
            <BarChart3 className="w-4 h-4 text-[#22ab68]" />
          </div>
          <span className="text-sm sm:text-base font-extrabold tracking-wider text-white">
            QUOTEX
          </span>
        </Link>

        <div className="flex items-center gap-2">
          <CurrencyToggleButton />

          <Link
            href="/dashboard"
            className="min-h-[38px] px-3 sm:px-3.5 py-2 rounded-lg bg-[#1d8cf8] hover:bg-[#167ae0] text-white text-xs font-bold flex items-center gap-1.5 whitespace-nowrap shrink-0"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Back to Desk</span>
          </Link>

          <Link
            href="/logout"
            prefetch={false}
            className="min-h-[38px] px-3 py-2 rounded-lg bg-[#252a3a] hover:bg-[#31384d] border border-[#343b4f] text-slate-200 hover:text-white text-xs font-bold flex items-center gap-1.5 whitespace-nowrap shrink-0"
          >
            <LogOut className="w-3.5 h-3.5 text-[#e34c3b]" />
            <span>Log Out</span>
          </Link>
        </div>
      </header>

      <main className="flex-1 max-w-5xl w-full mx-auto px-3 sm:px-6 py-5 sm:py-8 space-y-5 sm:space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3 pb-4 border-b border-[#262b38]">
          <div>
            <div className="flex items-center gap-2 text-xs font-semibold text-[#f59e0b] mb-1">
              <Trophy className="w-4 h-4" />
              <span>SUPABASE RPC · get_leaderboard_7d()</span>
            </div>
            <h1 className="text-lg sm:text-2xl font-bold text-white tracking-tight">
              Top 20 Traders by 7-Day Realized Profit
            </h1>
            <p className="text-xs text-[#8c94ab] mt-1">
              Aggregated in PostgreSQL via{' '}
              <code className="font-mono text-slate-300">
                public.get_leaderboard_7d()
              </code>{' '}
              over settled trades in the last 7 days.
            </p>
          </div>
          <span className="text-xs font-mono text-[#8c94ab] tabular-nums">
            Window: Last 7 Days · {currency}
            {currency === 'NPR' && rate
              ? ` (1 USDT = Rs ${rate.toFixed(2)})`
              : ''}
          </span>
        </div>

        {/* Mobile-First Rank Cards (< 640px) */}
        <div
          className={`sm:hidden space-y-2.5 transition-opacity duration-150 ${
            isFading ? 'opacity-30' : 'opacity-100'
          }`}
        >
          {rows.length === 0 ? (
            <div className="bg-[#232837] border border-[#2e3446] rounded-xl p-6 text-center text-xs text-[#8c94ab]">
              No settled trades recorded in the last 7 days yet. Place a trade
              on the terminal to appear on the leaderboard!
            </div>
          ) : (
            rows.map((row) => (
              <div
                key={row.userId}
                className="bg-[#232837] border border-[#2e3446] rounded-xl p-3.5 space-y-2.5 text-xs"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span className="w-7 h-7 rounded-lg bg-[#1c202b] border border-[#343b4f] font-mono font-bold text-white flex items-center justify-center shrink-0 tabular-nums">
                      #{row.rank}
                    </span>
                    <div className="min-w-0">
                      <div className="font-bold text-white truncate">
                        {row.name}
                      </div>
                    </div>
                  </div>

                  <div className="text-right font-mono tabular-nums shrink-0">
                    <div className="text-[10px] text-[#8c94ab]">7d Profit</div>
                    <div className="text-sm font-extrabold">
                      <span
                        className={
                          row.totalProfitNum > 0
                            ? 'text-[#22ab68]'
                            : row.totalProfitNum < 0
                              ? 'text-[#e34c3b]'
                              : 'text-slate-400'
                        }
                      >
                        {formatMoney(row.totalProfitNum, {
                          showPlusSign: row.totalProfitNum > 0,
                        })}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="pt-2 border-t border-[#2e3446]/70 grid grid-cols-3 gap-2 font-mono text-[11px] tabular-nums">
                  <div>
                    <span className="text-[#8c94ab] block text-[10px]">
                      Trades
                    </span>
                    <span className="text-slate-200 font-semibold">
                      {row.tradesCount}
                    </span>
                  </div>
                  <div>
                    <span className="text-[#8c94ab] block text-[10px]">
                      Volume
                    </span>
                    <span className="text-slate-200 font-semibold">
                      {formatMoney(row.totalVolumeNum)}
                    </span>
                  </div>
                  <div className="text-right">
                    <span className="text-[#8c94ab] block text-[10px]">
                      Balance
                    </span>
                    <span className="text-slate-200 font-semibold">
                      {formatMoney(row.currentBalanceNum)}
                    </span>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Tablet & Desktop Table (sm:block) */}
        <div
          className={`hidden sm:block bg-[#232837] border border-[#2e3446] rounded-xl overflow-hidden transition-opacity duration-150 ${
            isFading ? 'opacity-30' : 'opacity-100'
          }`}
        >
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-[#2e3446] bg-[#1c202b] text-[11px] font-semibold text-[#8c94ab]">
                <th className="py-3.5 px-5">Rank</th>
                <th className="py-3.5 px-4">Trader</th>
                <th className="py-3.5 px-4 text-right">Settled Trades</th>
                <th className="py-3.5 px-4 text-right">
                  7d Stake Volume ({currency})
                </th>
                <th className="py-3.5 px-4 text-right">
                  Current Balance ({currency})
                </th>
                <th className="py-3.5 px-5 text-right">
                  7-Day Net Profit ({currency})
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#2e3446]">
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-10 text-center text-[#8c94ab]">
                    No settled trades recorded in the last 7 days yet. Place a
                    trade on the terminal to appear on the leaderboard!
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr
                    key={row.userId}
                    className="hover:bg-[#1c202b]/60 transition-colors"
                  >
                    <td className="py-3.5 px-5 font-mono font-bold text-white tabular-nums">
                      #{row.rank}
                    </td>
                    <td className="py-3.5 px-4 font-bold text-white">
                      {row.name}
                    </td>
                    <td className="py-3.5 px-4 text-right font-mono text-slate-200 tabular-nums">
                      {row.tradesCount}
                    </td>
                    <td className="py-3.5 px-4 text-right font-mono text-slate-300 tabular-nums">
                      {formatMoney(row.totalVolumeNum)}
                    </td>
                    <td className="py-3.5 px-4 text-right font-mono text-slate-200 tabular-nums">
                      {formatMoney(row.currentBalanceNum)}
                    </td>
                    <td className="py-3.5 px-5 text-right font-mono font-extrabold tabular-nums">
                      <span
                        className={
                          row.totalProfitNum > 0
                            ? 'text-[#22ab68]'
                            : row.totalProfitNum < 0
                              ? 'text-[#e34c3b]'
                              : 'text-slate-400'
                        }
                      >
                        {formatMoney(row.totalProfitNum, {
                          showPlusSign: row.totalProfitNum > 0,
                        })}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </main>
    </div>
  );
}
