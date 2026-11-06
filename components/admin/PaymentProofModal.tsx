'use client';

import React, { useState, useEffect } from 'react';
import {
  X,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  Download,
  CheckCircle2,
  XCircle,
  Image as ImageIcon,
  User,
  Calendar,
  CreditCard,
  Eye,
} from 'lucide-react';
import { WalletRequestRow, resolveUserNumber } from '@/lib/supabase/types';
import { parsePaymentProofFromNote } from '@/lib/payment-details';

export function useResolvedProofSrc(screenshotUrl?: string | null): string | null {
  const [resolvedSrc, setResolvedSrc] = useState<string | null>(
    screenshotUrl || null
  );

  useEffect(() => {
    if (!screenshotUrl) {
      setResolvedSrc(null);
      return;
    }
    setResolvedSrc(screenshotUrl);

    if (typeof window !== 'undefined') {
      const match = screenshotUrl.match(/\/api\/payment-proof\/([a-zA-Z0-9_-]+)/);
      if (match?.[1]) {
        try {
          const cached = window.localStorage.getItem(
            `pulseoption_proof_${match[1]}`
          );
          if (cached && cached.startsWith('data:image/')) {
            // Keep server URL primary, fallback handled on error or if needed
          }
        } catch {
          // ignore
        }
      }
    }
  }, [screenshotUrl]);

  return resolvedSrc;
}

export function resolveFallbackLocalProof(screenshotUrl?: string | null): string | null {
  if (!screenshotUrl || typeof window === 'undefined') return null;
  const match = screenshotUrl.match(/\/api\/payment-proof\/([a-zA-Z0-9_-]+)/);
  if (!match?.[1]) return null;
  try {
    const cached = window.localStorage.getItem(`pulseoption_proof_${match[1]}`);
    if (cached && cached.startsWith('data:image/')) {
      return cached;
    }
  } catch {
    // ignore
  }
  return null;
}

export interface PaymentProofThumbnailProps {
  screenshotUrl: string;
  onClick: () => void;
  size?: 'sm' | 'md';
  label?: string;
}

export function PaymentProofThumbnail({
  screenshotUrl,
  onClick,
  size = 'md',
  label = 'View Payment Proof',
}: PaymentProofThumbnailProps) {
  const [imgSrc, setImgSrc] = useState<string>(screenshotUrl);
  const [failed, setFailed] = useState<boolean>(false);

  useEffect(() => {
    setImgSrc(screenshotUrl);
    setFailed(false);
  }, [screenshotUrl]);

  const handleImgError = () => {
    const localFallback = resolveFallbackLocalProof(screenshotUrl);
    if (localFallback && imgSrc !== localFallback) {
      setImgSrc(localFallback);
      return;
    }
    setFailed(true);
  };

  return (
    <div className="inline-flex items-center gap-2">
      <button
        type="button"
        onClick={onClick}
        className="group relative rounded-lg overflow-hidden border border-emerald-500/40 bg-[#070B12] hover:border-emerald-400 transition-all cursor-pointer shrink-0"
        title="Click to inspect full-size deposit payment proof screenshot"
      >
        {!failed ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={imgSrc}
            alt="Deposit payment proof"
            onError={handleImgError}
            className={
              size === 'sm'
                ? 'w-10 h-10 object-cover group-hover:scale-105 transition-transform'
                : 'w-12 h-12 object-cover group-hover:scale-105 transition-transform'
            }
          />
        ) : (
          <div
            className={
              size === 'sm'
                ? 'w-10 h-10 flex items-center justify-center text-emerald-400'
                : 'w-12 h-12 flex items-center justify-center text-emerald-400'
            }
          >
            <ImageIcon className="w-4 h-4" />
          </div>
        )}
        <div className="absolute inset-0 bg-black/45 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
          <Eye className="w-3.5 h-3.5 text-white" />
        </div>
      </button>

      <button
        type="button"
        onClick={onClick}
        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/35 text-xs font-bold text-emerald-300 transition-colors cursor-pointer"
      >
        <Eye className="w-3.5 h-3.5 shrink-0" />
        <span>{label}</span>
      </button>
    </div>
  );
}

export interface PaymentProofModalProps {
  request: WalletRequestRow | null;
  onClose: () => void;
  formatMoney: (amount: number | string) => string;
  canReview?: boolean;
  busy?: boolean;
  adminNote?: string;
  onAdminNoteChange?: (note: string) => void;
  onApprove?: (requestId: string) => void;
  onReject?: (requestId: string) => void;
}

export function PaymentProofModal({
  request,
  onClose,
  formatMoney,
  canReview = false,
  busy = false,
  adminNote = '',
  onAdminNoteChange,
  onApprove,
  onReject,
}: PaymentProofModalProps) {
  const [zoom, setZoom] = useState<number>(1);
  const [imgSrc, setImgSrc] = useState<string>('');
  const [imgFailed, setImgFailed] = useState<boolean>(false);

  const parsed = request ? parsePaymentProofFromNote(request.note) : null;
  const screenshotUrl = parsed?.screenshotUrl || '';

  useEffect(() => {
    setZoom(1);
    setImgFailed(false);
    setImgSrc(screenshotUrl);
  }, [screenshotUrl, request?.id]);

  if (!request || !parsed?.screenshotUrl) return null;

  const uNum = resolveUserNumber(request.user_number, request.user_id);

  const handleImgError = () => {
    const fallback = resolveFallbackLocalProof(screenshotUrl);
    if (fallback && imgSrc !== fallback) {
      setImgSrc(fallback);
      return;
    }
    setImgFailed(true);
  };

  return (
    <div
      className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-sm flex items-center justify-center p-3 sm:p-6 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-label="Deposit Payment Proof Screenshot"
      onClick={onClose}
    >
      <div
        className="w-full max-w-4xl bg-[#0B101B] border border-slate-800 rounded-2xl shadow-2xl overflow-hidden text-slate-100 my-auto max-h-[92vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Top Header */}
        <div className="px-4 sm:px-6 py-3.5 bg-[#070B12] border-b border-slate-800 flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-400 shrink-0">
              <ImageIcon className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <h2 className="text-sm sm:text-base font-bold text-white truncate">
                Deposit Payment Proof Screenshot
              </h2>
              <p className="text-[11px] text-slate-400 truncate">
                User ID: #{uNum}
                {request.user_display_name ? ` · ${request.user_display_name}` : ''}
                {request.user_email ? ` (${request.user_email})` : ''}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => setZoom((z) => Math.max(0.5, Number((z - 0.25).toFixed(2))))}
              className="p-2 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-slate-200 cursor-pointer"
              title="Zoom Out"
            >
              <ZoomOut className="w-4 h-4" />
            </button>
            <span className="px-2 py-1 rounded bg-slate-900 border border-slate-800 font-mono text-xs text-slate-300 tabular-nums">
              {Math.round(zoom * 100)}%
            </span>
            <button
              type="button"
              onClick={() => setZoom((z) => Math.min(3, Number((z + 0.25).toFixed(2))))}
              className="p-2 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-slate-200 cursor-pointer"
              title="Zoom In"
            >
              <ZoomIn className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => setZoom(1)}
              className="p-2 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-slate-200 cursor-pointer"
              title="Reset Zoom"
            >
              <RotateCcw className="w-4 h-4" />
            </button>
            {imgSrc && (
              <a
                href={imgSrc}
                download={`deposit-proof-user-${uNum}.jpg`}
                className="p-2 rounded-lg bg-indigo-500/15 hover:bg-indigo-500/25 border border-indigo-500/30 text-indigo-300"
                title="Download Payment Proof Image"
              >
                <Download className="w-4 h-4" />
              </a>
            )}
            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded-lg bg-slate-800 hover:bg-rose-500/20 text-slate-300 hover:text-rose-300 cursor-pointer ml-1"
              aria-label="Close modal"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Body: Image Canvas + Metadata Sidebar */}
        <div className="grid grid-cols-1 lg:grid-cols-12 flex-1 min-h-0 overflow-hidden">
          {/* Screenshot Preview Area */}
          <div className="lg:col-span-8 bg-[#05080e] flex items-center justify-center overflow-auto p-4 min-h-[300px] max-h-[55vh] lg:max-h-[72vh]">
            {!imgFailed ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                src={imgSrc}
                alt={`Payment proof from User #${uNum}`}
                onError={handleImgError}
                style={{
                  transform: `scale(${zoom})`,
                  transformOrigin: 'center center',
                }}
                className="max-w-full max-h-[64vh] object-contain rounded-lg border border-slate-800 shadow-xl transition-transform duration-150"
              />
            ) : (
              <div className="text-center p-8 space-y-2 max-w-sm">
                <ImageIcon className="w-10 h-10 text-slate-600 mx-auto" />
                <p className="text-sm font-semibold text-slate-300">
                  Screenshot Preview Unavailable
                </p>
                <p className="text-xs text-slate-500 font-mono break-all">
                  {screenshotUrl}
                </p>
              </div>
            )}
          </div>

          {/* Deposit Request Details & Quick Review Sidebar */}
          <div className="lg:col-span-4 border-t lg:border-t-0 lg:border-l border-slate-800 p-4 sm:p-5 flex flex-col justify-between gap-4 overflow-y-auto bg-[#0B101B]">
            <div className="space-y-3.5 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-slate-400 font-medium">Request Status</span>
                <span
                  className={`px-2.5 py-0.5 rounded font-mono font-bold text-[11px] ${
                    request.status === 'PENDING'
                      ? 'bg-amber-500/15 text-amber-300 border border-amber-500/30'
                      : request.status === 'APPROVED'
                        ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                        : 'bg-rose-500/15 text-rose-300 border border-rose-500/30'
                  }`}
                >
                  {request.status}
                </span>
              </div>

              <div className="p-3 rounded-xl bg-[#070B12] border border-slate-800/90 space-y-2">
                <div className="text-[11px] text-slate-400">Deposit Amount</div>
                <div className="text-lg font-mono font-bold text-emerald-400 tabular-nums">
                  {formatMoney(request.amount)}
                </div>
                <div className="text-[11px] font-mono text-slate-400 tabular-nums">
                  Base Credit: ${Number(request.amount).toFixed(2)} USDT
                </div>
                {parsed.enteredCurrencySummary && (
                  <div className="text-[11px] font-mono text-indigo-300 pt-1 border-t border-slate-800/80">
                    Entered: {parsed.enteredCurrencySummary}
                  </div>
                )}
              </div>

              <div className="space-y-2 p-3 rounded-xl bg-[#070B12] border border-slate-800/90">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-slate-400 flex items-center gap-1.5">
                    <User className="w-3.5 h-3.5 text-indigo-400" />
                    <span>User ID</span>
                  </span>
                  <span className="font-mono font-bold text-white">#{uNum}</span>
                </div>

                {parsed.methodLabel && (
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-slate-400 flex items-center gap-1.5">
                      <CreditCard className="w-3.5 h-3.5 text-emerald-400" />
                      <span>Payment Method</span>
                    </span>
                    <span className="px-2 py-0.5 rounded bg-emerald-500/15 border border-emerald-500/30 font-mono font-bold text-emerald-300 text-[11px]">
                      {parsed.methodLabel}
                    </span>
                  </div>
                )}

                <div className="flex items-center justify-between gap-2">
                  <span className="text-slate-400 flex items-center gap-1.5">
                    <Calendar className="w-3.5 h-3.5 text-slate-400" />
                    <span>Submitted</span>
                  </span>
                  <span className="font-mono text-slate-200 text-[11px]">
                    {new Date(request.created_at).toLocaleString()}
                  </span>
                </div>
              </div>

              {parsed.userNote && (
                <div className="p-3 rounded-xl bg-[#070B12] border border-slate-800/90 space-y-1">
                  <div className="text-[11px] text-slate-400">User Note</div>
                  <div className="text-xs text-slate-200 break-words">
                    {parsed.userNote}
                  </div>
                </div>
              )}

              {request.admin_note && (
                <div className="p-3 rounded-xl bg-indigo-500/10 border border-indigo-500/30 space-y-1">
                  <div className="text-[11px] text-indigo-300 font-semibold">
                    Admin Review Note
                  </div>
                  <div className="text-xs text-slate-200 break-words">
                    {request.admin_note}
                  </div>
                </div>
              )}
            </div>

            {/* Direct Approve / Reject Controls inside Modal */}
            {request.status === 'PENDING' && canReview && onApprove && onReject && (
              <div className="pt-3 border-t border-slate-800 space-y-2.5">
                {onAdminNoteChange && (
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                      Admin Review Note (Optional)
                    </label>
                    <input
                      type="text"
                      value={adminNote}
                      onChange={(e) => onAdminNoteChange(e.target.value)}
                      placeholder="Add verification note..."
                      className="w-full px-3 py-2 rounded-lg bg-[#070B12] border border-slate-800 text-xs text-white focus:outline-none focus:border-indigo-500"
                    />
                  </div>
                )}
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => onApprove(request.id)}
                    className="py-2.5 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
                  >
                    <CheckCircle2 className="w-4 h-4" />
                    <span>{busy ? 'Processing...' : 'Approve Deposit'}</span>
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => onReject(request.id)}
                    className="py-2.5 px-3 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
                  >
                    <XCircle className="w-4 h-4" />
                    <span>{busy ? 'Processing...' : 'Reject'}</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
