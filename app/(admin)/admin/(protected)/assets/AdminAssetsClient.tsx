'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { CandlestickChart, Save, RefreshCw, CheckCircle2, AlertCircle } from 'lucide-react';
import { AssetRow } from '@/lib/supabase/types';

function getDefaultAnchorPrice(symbol: string): number {
  if (symbol === 'BTC/USD') return 89420.5;
  if (symbol === 'ETH/USD') return 3185.25;
  if (symbol === 'EUR/USD') return 1.0842;
  if (symbol === 'GOLD') return 2745.8;
  return 100.0;
}

function getDefaultVolatilityPct(symbol: string): number {
  if (symbol === 'BTC/USD') return 0.02;
  if (symbol === 'ETH/USD') return 0.025;
  if (symbol === 'EUR/USD') return 0.004;
  if (symbol === 'GOLD') return 0.01;
  return 0.015;
}

export default function AdminAssetsPage() {
  const [assets, setAssets] = useState<AssetRow[]>([]);
  const [role, setRole] = useState<'SUPPORT' | 'ADMIN' | 'SUPERADMIN'>('SUPPORT');
  const [edits, setEdits] = useState<
    Record<string, { payout_percent: number; volatility: number; anchor_price: number; is_active: boolean }>
  >({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  const fetchAssets = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/actions?view=dashboard&days=7', {
        cache: 'no-store',
      });
      if (res.ok) {
        const json = await res.json();
        const list: AssetRow[] = json.assets || [];
        setAssets(list);
        if (json.session?.role) setRole(json.session.role);
        const initial: Record<
          string,
          { payout_percent: number; volatility: number; anchor_price: number; is_active: boolean }
        > = {};
        list.forEach((a) => {
          const rawPayout =
            a.payout_percent !== undefined
              ? Number(a.payout_percent)
              : a.payout_rate !== undefined
                ? Number(a.payout_rate) <= 1
                  ? Math.round(Number(a.payout_rate) * 100)
                  : Math.round(Number(a.payout_rate))
                : 85;
          const rawVol = Number(a.volatility);
          // Use anchor_price from the row directly
          const rawAnchor = Number(a.anchor_price ?? getDefaultAnchorPrice(a.symbol));
          
          initial[a.id] = {
            payout_percent: Number.isFinite(rawPayout) ? rawPayout : 85,
            volatility: Number.isFinite(rawVol) ? rawVol : getDefaultVolatilityPct(a.symbol),
            anchor_price: Number.isFinite(rawAnchor) ? rawAnchor : 100,
            is_active: Boolean(a.is_active),
          };
        });
        setEdits(initial);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAssets();
  }, [fetchAssets]);

  const canMutate = role === 'ADMIN' || role === 'SUPERADMIN';

  const handleSaveAsset = async (asset: AssetRow) => {
    const current = edits[asset.id];
    if (!current) return;

    const vol = Number(current.volatility);
    if (!Number.isFinite(vol) || vol < 0 || vol > 0.5) {
      setFeedback({
        type: 'err',
        text: `Invalid volatility for ${asset.symbol}: must be between 0.000 and 0.500 (% per 1-second tick).`,
      });
      return;
    }

    const anchorPrice = Number(current.anchor_price);
    if (!Number.isFinite(anchorPrice) || anchorPrice <= 0) {
      setFeedback({
        type: 'err',
        text: `Invalid anchor price for ${asset.symbol}: must be a positive number.`,
      });
      return;
    }

    const payoutPct = Math.round(Number(current.payout_percent));
    if (!Number.isFinite(payoutPct) || payoutPct < 1 || payoutPct > 99) {
      setFeedback({
        type: 'err',
        text: `Invalid payout percent for ${asset.symbol}: must be between 1% and 99%.`,
      });
      return;
    }

    setBusyId(asset.id);
    setFeedback(null);

    try {
      const res = await fetch('/api/admin/actions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'update_asset',
          assetId: asset.id,
          payoutPercent: payoutPct,
          volatility: vol,
          anchorPrice: anchorPrice,
          isActive: Boolean(current.is_active),
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setFeedback({ type: 'err', text: json.error || 'Failed to update asset.' });
      } else {
        setFeedback({
          type: 'ok',
          text: `Saved ${asset.symbol}: Base Price = ${anchorPrice.toFixed(asset.symbol === 'EUR/USD' ? 4 : 2)}, Volatility = ${vol.toFixed(3)}%/s`,
        });
        await fetchAssets();
      }
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white flex items-center gap-2.5">
            <CandlestickChart className="w-6 h-6 text-indigo-400" />
            <span>Market Asset Pricing</span>
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            Set the <span className="text-slate-200 font-semibold">BASE RATE</span> (Anchor Price) and optional volatility. 
            Set volatility to <code className="text-indigo-300">0</code> to keep the price static at the base rate.
          </p>
        </div>

        <button
          type="button"
          onClick={fetchAssets}
          className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-[#0B101B] border border-slate-800 text-xs text-slate-300 hover:text-white cursor-pointer"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          <span>Sync</span>
        </button>
      </div>

      {feedback && (
        <div
          className={`rounded-xl border p-3.5 flex items-center gap-2.5 text-xs ${
            feedback.type === 'ok'
              ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-200'
              : 'bg-rose-500/10 border-rose-500/30 text-rose-200'
          }`}
        >
          {feedback.type === 'ok' ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          ) : (
            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
          )}
          <span>{feedback.text}</span>
        </div>
      )}

      <div className="rounded-xl border border-slate-800/80 bg-[#0B101B] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-800 text-[11px] font-mono uppercase text-slate-400 bg-slate-900/40">
                <th className="py-3.5 px-4">Symbol</th>
                <th className="py-3.5 px-4">Name</th>
                <th className="py-3.5 px-4">Base Rate (Anchor)</th>
                <th className="py-3.5 px-4">Payout %</th>
                <th className="py-3.5 px-4">Volatility (%/s)</th>
                <th className="py-3.5 px-4">Expected Range (30s)</th>
                <th className="py-3.5 px-4">Active</th>
                <th className="py-3.5 px-4 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 text-xs">
              {assets.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-slate-500">
                    No market assets loaded from database.
                  </td>
                </tr>
              ) : (
                assets.map((asset) => {
                  const decimals = asset.symbol === 'EUR/USD' ? 4 : 2;
                  const edit = edits[asset.id] || {
                    payout_percent: Number(asset.payout_percent ?? 85),
                    volatility: Number(asset.volatility ?? 0.02),
                    anchor_price: Number(asset.anchor_price ?? 100),
                    is_active: Boolean(asset.is_active),
                  };

                  const volPct = Number(edit.volatility) || 0;
                  const rangePct30s = volPct * Math.sqrt(30);
                  const rangeUsd30s = Number(edit.anchor_price) * (rangePct30s / 100);
                  const isVolOutOfRange = volPct < 0 || volPct > 0.5;

                  return (
                    <tr key={asset.id} className="hover:bg-slate-800/30">
                      <td className="py-3.5 px-4 font-mono font-bold text-white">
                        {asset.symbol}
                      </td>
                      <td className="py-3.5 px-4 text-slate-300">{asset.name}</td>
                      <td className="py-3.5 px-4">
                        <div className="inline-flex items-center gap-1.5">
                          <span className="text-slate-500 font-mono">$</span>
                          <input
                            type="number"
                            step={decimals === 4 ? "0.0001" : "0.01"}
                            disabled={!canMutate}
                            value={edit.anchor_price}
                            onChange={(e) =>
                              setEdits((prev) => ({
                                ...prev,
                                [asset.id]: {
                                  ...edit,
                                  anchor_price: Number(e.target.value),
                                },
                              }))
                            }
                            className="w-28 px-2.5 py-1 rounded bg-[#070B12] border border-slate-800 font-mono text-white disabled:opacity-50"
                          />
                        </div>
                      </td>
                      <td className="py-3.5 px-4">
                        <div className="inline-flex items-center gap-1.5">
                          <input
                            type="number"
                            step="1"
                            min="1"
                            max="99"
                            disabled={!canMutate}
                            value={edit.payout_percent}
                            onChange={(e) =>
                              setEdits((prev) => ({
                                ...prev,
                                [asset.id]: {
                                  ...edit,
                                  payout_percent: Number(e.target.value),
                                },
                              }))
                            }
                            className="w-16 px-2.5 py-1 rounded bg-[#070B12] border border-slate-800 font-mono text-white disabled:opacity-50"
                          />
                          <span className="text-slate-500 font-mono">%</span>
                        </div>
                      </td>
                      <td className="py-3.5 px-4">
                        <div className="inline-flex items-center gap-1.5">
                          <input
                            type="number"
                            step="0.001"
                            min="0"
                            max="0.5"
                            disabled={!canMutate}
                            value={edit.volatility}
                            onChange={(e) =>
                              setEdits((prev) => ({
                                ...prev,
                                [asset.id]: {
                                  ...edit,
                                  volatility: Number(e.target.value),
                                },
                              }))
                            }
                            className={`w-24 px-2.5 py-1 rounded bg-[#070B12] border font-mono text-white disabled:opacity-50 ${
                              isVolOutOfRange
                                ? 'border-rose-500/80 text-rose-300'
                                : 'border-slate-800'
                            }`}
                          />
                          <span className="text-slate-500 font-mono">%/s</span>
                        </div>
                      </td>
                      <td className="py-3.5 px-4 font-mono text-slate-300">
                        {volPct > 0 ? (
                          <>
                            <span className="text-indigo-300 font-semibold">
                              ~${rangeUsd30s.toFixed(decimals)}
                            </span>{' '}
                            <span className="text-slate-500">
                              ({rangePct30s.toFixed(3)}%)
                            </span>
                          </>
                        ) : (
                          <span className="text-slate-500 italic">Static Price</span>
                        )}
                      </td>
                      <td className="py-3.5 px-4">
                        <input
                          type="checkbox"
                          disabled={!canMutate}
                          checked={edit.is_active}
                          onChange={(e) =>
                            setEdits((prev) => ({
                              ...prev,
                              [asset.id]: {
                                ...edit,
                                is_active: e.target.checked,
                              },
                            }))
                          }
                          className="w-4 h-4 accent-indigo-600"
                        />
                      </td>
                      <td className="py-3.5 px-4 text-right">
                        {canMutate ? (
                          <button
                            type="button"
                            disabled={busyId === asset.id || isVolOutOfRange}
                            onClick={() => handleSaveAsset(asset)}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium cursor-pointer disabled:opacity-50"
                          >
                            <Save className="w-3.5 h-3.5" />
                            <span>Save</span>
                          </button>
                        ) : (
                          <span className="text-[11px] font-mono text-slate-500">
                            Read-Only
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
