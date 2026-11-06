'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import Link from 'next/link';
import {
  WalletCards,
  CheckCircle2,
  XCircle,
  RefreshCw,
  AlertCircle,
  AlertTriangle,
  Search,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Copy,
  Check,
  Share2,
  QrCode,
  Eye,
  EyeOff,
  MessageSquare,
  Save,
} from 'lucide-react';
import { getSupabaseAdminBrowserClient } from '@/lib/supabase/admin-client';
import { resolveUserNumber, WalletRequestRow } from '@/lib/supabase/types';
import { useCurrency } from '@/components/CurrencyProvider';
import {
  DEFAULT_MANUAL_PAYMENT_DETAILS,
  ManualPaymentDetailsState,
  parsePaymentProofFromNote,
} from '@/lib/payment-details';
import {
  PaymentProofModal,
  PaymentProofThumbnail,
} from '@/components/admin/PaymentProofModal';

type SortField = 'user_number' | 'amount' | 'created_at';
type SortDir = 'asc' | 'desc';

export default function AdminRequestsPage() {
  const { currency, formatMoney } = useCurrency();
  const [copiedUtrId, setCopiedUtrId] = useState<string | null>(null);
  const [copiedShareLink, setCopiedShareLink] = useState<boolean>(false);
  const [requests, setRequests] = useState<WalletRequestRow[]>([]);
  const [role, setRole] = useState<'SUPPORT' | 'ADMIN' | 'SUPERADMIN'>('SUPPORT');
  const [statusFilter, setStatusFilter] = useState<string>('PENDING');
  const [typeFilter, setTypeFilter] = useState<string>('ALL');
  const [dateFilter, setDateFilter] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [sortField, setSortField] = useState<SortField>('created_at');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  const [adminNotes, setAdminNotes] = useState<Record<string, string>>({});
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bulkNote, setBulkNote] = useState<string>('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  const [paymentDetails, setPaymentDetails] =
    useState<ManualPaymentDetailsState>(DEFAULT_MANUAL_PAYMENT_DETAILS);
  const [savingDepositConfig, setSavingDepositConfig] =
    useState<boolean>(false);
  const [showDepositConfigPanel, setShowDepositConfigPanel] =
    useState<boolean>(false);
  const [previewRequestId, setPreviewRequestId] = useState<string | null>(null);

  const fetchRequests = useCallback(async () => {
    setLoading(true);
    try {
      const [res, payRes] = await Promise.all([
        fetch('/api/admin/actions?view=dashboard&days=90', {
          cache: 'no-store',
        }),
        fetch('/api/payment-details', { cache: 'no-store' }),
      ]);
      if (res.ok) {
        const json = await res.json();
        setRequests(json.walletRequests || []);
        if (json.session?.role) setRole(json.session.role);
      }
      if (payRes.ok) {
        const payJson = await payRes.json();
        if (payJson?.paymentDetails) {
          setPaymentDetails(payJson.paymentDetails);
        }
      }
    } finally {
      setLoading(false);
    }
  }, []);

  const handleSaveDepositVisibilityAndMessage = async (
    nextOverride?: Partial<ManualPaymentDetailsState>
  ) => {
    setSavingDepositConfig(true);
    setErrorMsg(null);
    setSuccessMsg(null);
    const payload = {
      ...paymentDetails,
      ...nextOverride,
    };
    try {
      const res = await fetch('/api/payment-details', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok) {
        setErrorMsg(json.error || 'Failed to update deposit visibility & message.');
      } else {
        if (json.paymentDetails) {
          setPaymentDetails(json.paymentDetails);
        }
        setSuccessMsg(
          payload.hideDepositDetails
            ? 'Deposit account details are now HIDDEN and your custom deposit message is active.'
            : 'Deposit settings and custom message updated.'
        );
      }
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'Failed to update deposit settings.'
      );
    } finally {
      setSavingDepositConfig(false);
    }
  };

  useEffect(() => {
    fetchRequests();
  }, [fetchRequests]);

  useEffect(() => {
    const supabase = getSupabaseAdminBrowserClient();
    if (!supabase) return;

    const channel = supabase
      .channel('admin-wallet-requests-realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'wallet_requests' },
        () => {
          fetchRequests();
        }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'profiles' },
        () => {
          fetchRequests();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [fetchRequests]);

  const handleReview = async (requestId: string, approve: boolean) => {
    setBusyId(requestId);
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      const res = await fetch('/api/admin/actions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'review_request',
          requestId,
          approve,
          adminNote: adminNotes[requestId] || undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setErrorMsg(json.error || 'Failed to review request.');
      } else {
        setSuccessMsg(
          `Request ${approve ? 'approved' : 'rejected'} atomically.`
        );
        setSelectedIds((prev) => prev.filter((id) => id !== requestId));
        await fetchRequests();
      }
    } finally {
      setBusyId(null);
    }
  };

  const handleBulkReview = async (approve: boolean) => {
    if (selectedIds.length === 0) return;
    setBulkBusy(true);
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      const res = await fetch('/api/admin/actions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'bulk_review_requests',
          requestIds: selectedIds,
          approve,
          adminNote: bulkNote.trim() || undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setErrorMsg(json.error || 'Bulk review failed.');
      } else {
        const okCount = Array.isArray(json.succeeded) ? json.succeeded.length : 0;
        const failCount = Array.isArray(json.failed) ? json.failed.length : 0;
        if (failCount > 0) {
          setErrorMsg(
            `Processed ${okCount} requests; ${failCount} failed: ${json.failed[0]?.error || ''}`
          );
        } else {
          setSuccessMsg(
            `Bulk ${approve ? 'approved' : 'rejected'} ${okCount} request(s).`
          );
        }
        setSelectedIds([]);
        setBulkNote('');
        await fetchRequests();
      }
    } finally {
      setBulkBusy(false);
    }
  };

  const canReview = role === 'ADMIN' || role === 'SUPERADMIN';

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDir('asc');
    }
  };

  const renderSortIcon = (field: SortField) => {
    if (sortField !== field) {
      return <ArrowUpDown className="w-3.5 h-3.5 text-slate-500" />;
    }
    return sortDir === 'asc' ? (
      <ArrowUp className="w-3.5 h-3.5 text-indigo-400" />
    ) : (
      <ArrowDown className="w-3.5 h-3.5 text-indigo-400" />
    );
  };

  const filteredAndSorted = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const isExactFiveDigit = /^\d{5}$/.test(q);
    const nowMs = Date.now();

    const filtered = requests.filter((r) => {
      if (statusFilter !== 'ALL' && r.status !== statusFilter) return false;
      if (typeFilter !== 'ALL' && r.type !== typeFilter) return false;

      if (dateFilter !== 'ALL') {
        const createdMs = new Date(r.created_at).getTime();
        const maxAgeMs =
          dateFilter === 'TODAY'
            ? 24 * 3600 * 1000
            : dateFilter === '7D'
            ? 7 * 24 * 3600 * 1000
            : 30 * 24 * 3600 * 1000;
        if (nowMs - createdMs > maxAgeMs) return false;
      }

      if (!q) return true;
      const uNum = resolveUserNumber(r.user_number, r.user_id);
      if (isExactFiveDigit && String(uNum) === q) return true;
      return (
        String(uNum).includes(q) ||
        (r.user_email || '').toLowerCase().includes(q) ||
        (r.user_display_name || '').toLowerCase().includes(q) ||
        (r.note || '').toLowerCase().includes(q) ||
        r.user_id.toLowerCase().includes(q)
      );
    });

    return filtered.sort((a, b) => {
      const aNum = resolveUserNumber(a.user_number, a.user_id);
      const bNum = resolveUserNumber(b.user_number, b.user_id);

      if (isExactFiveDigit) {
        const aExact = String(aNum) === q ? 0 : 1;
        const bExact = String(bNum) === q ? 0 : 1;
        if (aExact !== bExact) return aExact - bExact;
      }

      const mul = sortDir === 'asc' ? 1 : -1;
      if (sortField === 'user_number') {
        return (aNum - bNum) * mul;
      }
      if (sortField === 'amount') {
        return (Number(a.amount) - Number(b.amount)) * mul;
      }
      return (
        (new Date(a.created_at).getTime() - new Date(b.created_at).getTime()) *
        mul
      );
    });
  }, [requests, statusFilter, typeFilter, dateFilter, searchQuery, sortField, sortDir]);

  const pendingInView = useMemo(
    () => filteredAndSorted.filter((r) => r.status === 'PENDING'),
    [filteredAndSorted]
  );

  const toggleSelectAllPending = () => {
    if (selectedIds.length === pendingInView.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(pendingInView.map((r) => r.id));
    }
  };

  const toggleSelectRow = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const counts = useMemo(() => {
    return {
      PENDING: requests.filter((r) => r.status === 'PENDING').length,
      APPROVED: requests.filter((r) => r.status === 'APPROVED').length,
      REJECTED: requests.filter((r) => r.status === 'REJECTED').length,
      ALL: requests.length,
    };
  }, [requests]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white flex items-center gap-2.5">
            <WalletCards className="w-6 h-6 text-emerald-400" />
            <span>Wallet Requests Queue</span>
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            Atomic &amp; idempotent review of deposit and withdrawal requests.
          </p>
        </div>

        {/* Status Tabs & Quick Share Payment Details */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={async () => {
              const url = `${window.location.origin}/wallet/payment-details`;
              try {
                await navigator.clipboard.writeText(url);
                setCopiedShareLink(true);
                setTimeout(() => setCopiedShareLink(false), 2000);
              } catch {
                // ignore
              }
            }}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/30 text-emerald-300 flex items-center gap-1.5 cursor-pointer"
            title="Copy Payment Details Page Link to share with user"
          >
            {copiedShareLink ? (
              <>
                <Check className="w-3.5 h-3.5 text-emerald-400" />
                <span>Link Copied!</span>
              </>
            ) : (
              <>
                <Share2 className="w-3.5 h-3.5" />
                <span>Share Payment Link</span>
              </>
            )}
          </button>

          {canReview && (
            <button
              type="button"
              onClick={() => setShowDepositConfigPanel((prev) => !prev)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold border flex items-center gap-1.5 cursor-pointer ${
                paymentDetails.hideDepositDetails
                  ? 'bg-amber-500/15 hover:bg-amber-500/25 border-amber-500/40 text-amber-300'
                  : 'bg-[#0B101B] hover:bg-slate-800 border-slate-800 text-slate-200'
              }`}
            >
              {paymentDetails.hideDepositDetails ? (
                <EyeOff className="w-3.5 h-3.5 text-amber-400" />
              ) : (
                <Eye className="w-3.5 h-3.5 text-emerald-400" />
              )}
              <span>
                {paymentDetails.hideDepositDetails
                  ? 'Deposit Details: Hidden'
                  : 'Hide Deposit & Set Message'}
              </span>
            </button>
          )}

          <Link
            href="/admin/settings/payment-details"
            className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-[#0B101B] hover:bg-slate-800 border border-slate-800 text-slate-200 flex items-center gap-1.5"
          >
            <QrCode className="w-3.5 h-3.5 text-indigo-400" />
            <span>Configure Payment Details</span>
          </Link>

          {(['PENDING', 'APPROVED', 'REJECTED', 'ALL'] as const).map((st) => (
            <button
              key={st}
              type="button"
              onClick={() => {
                setStatusFilter(st);
                setSelectedIds([]);
              }}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 cursor-pointer ${
                statusFilter === st
                  ? 'bg-indigo-600 text-white'
                  : 'bg-[#0B101B] border border-slate-800 text-slate-400 hover:text-white'
              }`}
            >
              <span>
                {st === 'PENDING'
                  ? 'Pending'
                  : st === 'APPROVED'
                  ? 'Approved'
                  : st === 'REJECTED'
                  ? 'Rejected'
                  : 'All'}
              </span>
              <span className="px-1.5 py-0.2 rounded bg-black/30 font-mono text-[10px]">
                {counts[st]}
              </span>
            </button>
          ))}
          <button
            type="button"
            onClick={fetchRequests}
            className="p-2 rounded-lg bg-[#0B101B] border border-slate-800 text-slate-300 hover:text-white cursor-pointer"
            title="Refresh Queue"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Inline Quick Control: Hide Deposit Details & Put Message for Deposit */}
      {canReview && (showDepositConfigPanel || paymentDetails.hideDepositDetails) && (
        <div
          className={`rounded-xl border p-4 space-y-3.5 transition-colors ${
            paymentDetails.hideDepositDetails
              ? 'border-amber-500/40 bg-amber-500/[0.06]'
              : 'border-slate-800 bg-[#0B101B]'
          }`}
        >
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-start gap-2.5">
              {paymentDetails.hideDepositDetails ? (
                <EyeOff className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
              ) : (
                <MessageSquare className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
              )}
              <div>
                <div className="text-xs font-bold text-white flex items-center gap-2">
                  <span>Deposit Details Visibility &amp; Deposit Message</span>
                  <span
                    className={`px-2 py-0.5 rounded text-[10px] font-mono uppercase ${
                      paymentDetails.hideDepositDetails
                        ? 'bg-amber-500/20 text-amber-300'
                        : 'bg-emerald-500/15 text-emerald-300'
                    }`}
                  >
                    {paymentDetails.hideDepositDetails
                      ? 'Details Hidden from Users'
                      : 'Details Visible to Users'}
                  </span>
                </div>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  Hide receiving account numbers &amp; QR codes in Deposit and
                  show a custom message to users.
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={savingDepositConfig}
                onClick={() => {
                  const nextHidden = !paymentDetails.hideDepositDetails;
                  setPaymentDetails((prev) => ({
                    ...prev,
                    hideDepositDetails: nextHidden,
                  }));
                  void handleSaveDepositVisibilityAndMessage({
                    hideDepositDetails: nextHidden,
                  });
                }}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 cursor-pointer disabled:opacity-50 ${
                  paymentDetails.hideDepositDetails
                    ? 'bg-emerald-600 hover:bg-emerald-500 text-white'
                    : 'bg-amber-600 hover:bg-amber-500 text-white'
                }`}
              >
                {paymentDetails.hideDepositDetails ? (
                  <>
                    <Eye className="w-3.5 h-3.5" />
                    <span>Show Deposit Details</span>
                  </>
                ) : (
                  <>
                    <EyeOff className="w-3.5 h-3.5" />
                    <span>Hide Deposit Details</span>
                  </>
                )}
              </button>

              <button
                type="button"
                disabled={savingDepositConfig}
                onClick={() => void handleSaveDepositVisibilityAndMessage()}
                className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                <Save className="w-3.5 h-3.5" />
                <span>
                  {savingDepositConfig ? 'Saving...' : 'Save Deposit Message'}
                </span>
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 items-start">
            <div className="lg:col-span-9">
              <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                Custom Deposit Message Shown to Users
              </label>
              <textarea
                rows={2}
                value={paymentDetails.depositMessage || ''}
                onChange={(e) =>
                  setPaymentDetails((prev) => ({
                    ...prev,
                    depositMessage: e.target.value,
                  }))
                }
                placeholder="Write a message to show users on the Deposit screen..."
                className="w-full px-3 py-2 rounded-lg bg-[#070B12] border border-slate-800 focus:border-amber-500 focus:outline-none text-xs text-white"
              />
            </div>

            <div className="lg:col-span-3 pt-1 lg:pt-5 space-y-2">
              <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={Boolean(paymentDetails.hideDepositDetails)}
                  onChange={(e) =>
                    setPaymentDetails((prev) => ({
                      ...prev,
                      hideDepositDetails: e.target.checked,
                    }))
                  }
                  className="w-4 h-4 accent-amber-500"
                />
                <span>Hide Deposit Details</span>
              </label>

              <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={Boolean(paymentDetails.showDepositMessageBanner)}
                  onChange={(e) =>
                    setPaymentDetails((prev) => ({
                      ...prev,
                      showDepositMessageBanner: e.target.checked,
                    }))
                  }
                  className="w-4 h-4 accent-emerald-500"
                />
                <span>Show Message Banner Always</span>
              </label>
            </div>
          </div>
        </div>
      )}

      {/* Search by User ID & Filters (Type, Date) */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 bg-[#0B101B] border border-slate-800/80 rounded-xl p-4">
        <div className="sm:col-span-2 relative">
          <Search className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by 5-digit User ID (e.g. 48213), email, name, or note..."
            className="w-full pl-10 pr-4 py-2 rounded-lg bg-[#070B12] border border-slate-800 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
          />
        </div>

        <div>
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="w-full px-3 py-2 rounded-lg bg-[#070B12] border border-slate-800 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
          >
            <option value="ALL">All Types (Deposit &amp; Withdraw)</option>
            <option value="DEPOSIT">DEPOSIT Only</option>
            <option value="WITHDRAW">WITHDRAW Only</option>
          </select>
        </div>

        <div>
          <select
            value={dateFilter}
            onChange={(e) => setDateFilter(e.target.value)}
            className="w-full px-3 py-2 rounded-lg bg-[#070B12] border border-slate-800 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
          >
            <option value="ALL">All Dates</option>
            <option value="TODAY">Last 24 Hours</option>
            <option value="7D">Last 7 Days</option>
            <option value="30D">Last 30 Days</option>
          </select>
        </div>
      </div>

      {/* Bulk Actions Bar */}
      {canReview && selectedIds.length > 0 && (
        <div className="rounded-xl border border-indigo-500/40 bg-indigo-500/10 p-3.5 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="text-xs font-bold text-indigo-200">
              {selectedIds.length} pending request(s) selected
            </span>
            <input
              type="text"
              value={bulkNote}
              onChange={(e) => setBulkNote(e.target.value)}
              placeholder="Optional bulk review note..."
              className="px-3 py-1.5 rounded-lg bg-[#070B12] border border-slate-800 text-xs text-white w-64"
            />
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={bulkBusy}
              onClick={() => handleBulkReview(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold cursor-pointer disabled:opacity-50"
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>Bulk Approve ({selectedIds.length})</span>
            </button>
            <button
              type="button"
              disabled={bulkBusy}
              onClick={() => handleBulkReview(false)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold cursor-pointer disabled:opacity-50"
            >
              <XCircle className="w-3.5 h-3.5" />
              <span>Bulk Reject ({selectedIds.length})</span>
            </button>
            <button
              type="button"
              onClick={() => setSelectedIds([])}
              className="px-2.5 py-1.5 rounded-lg border border-slate-700 text-xs text-slate-300 hover:text-white cursor-pointer"
            >
              Clear
            </button>
          </div>
        </div>
      )}

      {errorMsg && (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3.5 flex items-center gap-2.5 text-xs text-rose-200">
          <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {successMsg && (
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3.5 flex items-center gap-2.5 text-xs text-emerald-200">
          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          <span>{successMsg}</span>
        </div>
      )}

      <div className="rounded-xl border border-slate-800/80 bg-[#0B101B] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-800 text-[11px] font-mono uppercase text-slate-400 bg-slate-900/40">
                {canReview && (
                  <th className="py-3.5 px-3 w-9">
                    <input
                      type="checkbox"
                      checked={
                        pendingInView.length > 0 &&
                        selectedIds.length === pendingInView.length
                      }
                      disabled={pendingInView.length === 0}
                      onChange={toggleSelectAllPending}
                      aria-label="Select all pending requests"
                      className="rounded border-slate-700 bg-slate-900 text-indigo-600 cursor-pointer"
                    />
                  </th>
                )}
                <th className="py-3.5 px-4">
                  <button
                    type="button"
                    onClick={() => handleSort('user_number')}
                    className="inline-flex items-center gap-1.5 hover:text-white cursor-pointer"
                  >
                    <span>User ID</span>
                    {renderSortIcon('user_number')}
                  </button>
                </th>
                <th className="py-3.5 px-4">Type</th>
                <th className="py-3.5 px-4 text-right">
                  <button
                    type="button"
                    onClick={() => handleSort('amount')}
                    className="inline-flex items-center justify-end gap-1.5 hover:text-white cursor-pointer ml-auto"
                  >
                    <span>Amount</span>
                    {renderSortIcon('amount')}
                  </button>
                </th>
                <th className="py-3.5 px-4 text-right">Current Balance</th>
                <th className="py-3.5 px-4">Status</th>
                <th className="py-3.5 px-4">Payment Proof / Details</th>
                <th className="py-3.5 px-4">
                  <button
                    type="button"
                    onClick={() => handleSort('created_at')}
                    className="inline-flex items-center gap-1.5 hover:text-white cursor-pointer"
                  >
                    <span>Created</span>
                    {renderSortIcon('created_at')}
                  </button>
                </th>
                <th className="py-3.5 px-4 text-right">Decision</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 text-xs">
              {filteredAndSorted.length === 0 ? (
                <tr>
                  <td
                    colSpan={canReview ? 9 : 8}
                    className="py-12 text-center text-slate-500"
                  >
                    No wallet requests matching current filters.
                  </td>
                </tr>
              ) : (
                filteredAndSorted.map((req) => {
                  const uNum = resolveUserNumber(req.user_number, req.user_id);
                  const userBal =
                    req.user_balance !== undefined ? Number(req.user_balance) : null;
                  const exceedsBalance =
                    req.type === 'WITHDRAW' &&
                    req.status === 'PENDING' &&
                    userBal !== null &&
                    Number(req.amount) > userBal;

                  return (
                    <tr key={req.id} className="hover:bg-slate-800/30">
                      {canReview && (
                        <td className="py-3.5 px-3">
                          {req.status === 'PENDING' ? (
                            <input
                              type="checkbox"
                              checked={selectedIds.includes(req.id)}
                              onChange={() => toggleSelectRow(req.id)}
                              className="rounded border-slate-700 bg-slate-900 text-indigo-600 cursor-pointer"
                            />
                          ) : null}
                        </td>
                      )}
                      <td className="py-3.5 px-4">
                        <Link
                          href={`/admin/users/${req.user_id}`}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-indigo-500/15 hover:bg-indigo-500/25 border border-indigo-500/30 font-mono font-bold text-indigo-300 text-xs transition-colors"
                          title={`Inspect User ID ${uNum}`}
                        >
                          <span>{uNum}</span>
                        </Link>
                        {req.user_display_name && (
                          <div className="text-[11px] text-slate-400 mt-0.5 truncate max-w-[140px]">
                            {req.user_display_name}
                          </div>
                        )}
                      </td>
                      <td className="py-3.5 px-4">
                        <span
                          className={`px-2 py-0.5 text-[10px] font-mono font-semibold rounded ${
                            req.type === 'DEPOSIT'
                              ? 'bg-emerald-500/15 text-emerald-300'
                              : 'bg-amber-500/15 text-amber-300'
                          }`}
                        >
                          {req.type}
                        </span>
                      </td>
                      <td className="py-3.5 px-4 text-right">
                        <div className="font-mono font-bold text-white tabular-nums">
                          {formatMoney(req.amount)}
                        </div>
                        {currency === 'NPR' && (
                          <div className="text-[10px] font-mono text-slate-500 tabular-nums">
                            Base: ${Number(req.amount).toFixed(2)} USDT
                          </div>
                        )}
                        {exceedsBalance && (
                          <div className="mt-1 inline-flex items-center gap-1 px-2 py-0.5 rounded bg-rose-500/20 border border-rose-500/40 text-[10px] font-semibold text-rose-300">
                            <AlertTriangle className="w-3 h-3 shrink-0" />
                            <span>Exceeds balance!</span>
                          </div>
                        )}
                      </td>
                      <td className="py-3.5 px-4 text-right font-mono text-slate-300 tabular-nums">
                        {userBal !== null ? formatMoney(userBal) : '—'}
                      </td>
                      <td className="py-3.5 px-4">
                        <span
                          className={`px-2 py-0.5 text-[10px] font-mono font-semibold rounded ${
                            req.status === 'PENDING'
                              ? 'bg-amber-500/15 text-amber-300'
                              : req.status === 'APPROVED'
                              ? 'bg-emerald-500/15 text-emerald-300'
                              : 'bg-rose-500/15 text-rose-300'
                          }`}
                        >
                          {req.status}
                        </span>
                      </td>
                      <td className="py-3.5 px-4">
                        {(() => {
                          const parsed = parsePaymentProofFromNote(req.note);
                          return (
                            <div className="space-y-2 max-w-sm">
                              {parsed.screenshotUrl && (
                                <div className="pt-0.5">
                                  <PaymentProofThumbnail
                                    screenshotUrl={parsed.screenshotUrl}
                                    onClick={() => setPreviewRequestId(req.id)}
                                    size="md"
                                    label="View Payment Proof"
                                  />
                                </div>
                              )}
                              {(parsed.methodLabel ||
                                parsed.payoutBankName ||
                                parsed.payoutAccountId ||
                                parsed.payoutAccountName ||
                                parsed.transactionId ||
                                parsed.enteredCurrencySummary) && (
                                <div className="flex flex-wrap items-center gap-1.5">
                                  {parsed.methodLabel && (
                                    <span className="px-1.5 py-0.5 rounded bg-indigo-500/15 border border-indigo-500/30 text-[10px] font-mono font-bold text-indigo-300">
                                      {parsed.methodLabel}
                                    </span>
                                  )}
                                  {parsed.enteredCurrencySummary && (
                                    <span className="px-1.5 py-0.5 rounded bg-slate-800 border border-slate-700 text-[10px] font-mono text-slate-300">
                                      {parsed.enteredCurrencySummary}
                                    </span>
                                  )}
                                  {parsed.payoutBankName && (
                                    <span className="px-1.5 py-0.5 rounded bg-slate-800 border border-slate-700 text-[10px] font-mono text-slate-200">
                                      Bank: {parsed.payoutBankName}
                                      {parsed.payoutBranchName
                                        ? ` (${parsed.payoutBranchName})`
                                        : ''}
                                    </span>
                                  )}
                                  {parsed.payoutAccountId && (
                                    <button
                                      type="button"
                                      onClick={async () => {
                                        try {
                                          await navigator.clipboard.writeText(
                                            parsed.payoutAccountId || ''
                                          );
                                          setCopiedUtrId(`payout-${req.id}`);
                                          setTimeout(
                                            () => setCopiedUtrId(null),
                                            1800
                                          );
                                        } catch {
                                          // ignore
                                        }
                                      }}
                                      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/30 text-[10px] font-mono font-bold text-amber-300 cursor-pointer"
                                      title="Click to copy Payout Account / Wallet ID"
                                    >
                                      <span>
                                        {parsed.methodCode === 'BANK_TRANSFER'
                                          ? `A/C: ${parsed.payoutAccountId}`
                                          : `ID: ${parsed.payoutAccountId}`}
                                      </span>
                                      {copiedUtrId === `payout-${req.id}` ? (
                                        <Check className="w-2.5 h-2.5 text-emerald-400" />
                                      ) : (
                                        <Copy className="w-2.5 h-2.5" />
                                      )}
                                    </button>
                                  )}
                                  {parsed.payoutAccountName && (
                                    <span className="px-1.5 py-0.5 rounded bg-slate-800/80 border border-slate-700 text-[10px] font-semibold text-slate-200">
                                      Name: {parsed.payoutAccountName}
                                    </span>
                                  )}
                                  {parsed.transactionId && (
                                    <button
                                      type="button"
                                      onClick={async () => {
                                        try {
                                          await navigator.clipboard.writeText(
                                            parsed.transactionId || ''
                                          );
                                          setCopiedUtrId(req.id);
                                          setTimeout(
                                            () => setCopiedUtrId(null),
                                            1800
                                          );
                                        } catch {
                                          // ignore
                                        }
                                      }}
                                      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/30 text-[10px] font-mono font-bold text-emerald-300 cursor-pointer"
                                      title="Click to copy Transaction ID / UTR"
                                    >
                                      <span>UTR: {parsed.transactionId}</span>
                                      {copiedUtrId === req.id ? (
                                        <Check className="w-2.5 h-2.5 text-emerald-400" />
                                      ) : (
                                        <Copy className="w-2.5 h-2.5" />
                                      )}
                                    </button>
                                  )}
                                </div>
                              )}
                              {!parsed.screenshotUrl && req.type === 'DEPOSIT' && (
                                <div className="text-[11px] font-mono text-amber-300/80">
                                  No screenshot attached
                                </div>
                              )}
                              {(parsed.userNote ||
                                (!parsed.methodLabel &&
                                  !parsed.screenshotUrl &&
                                  req.note)) && (
                                <div
                                  className="text-slate-300 truncate"
                                  title={req.note || ''}
                                >
                                  {parsed.userNote || req.note || '—'}
                                </div>
                              )}
                            </div>
                          );
                        })()}
                        {req.status === 'PENDING' && canReview ? (
                          <input
                            type="text"
                            value={adminNotes[req.id] || ''}
                            onChange={(e) =>
                              setAdminNotes((prev) => ({
                                ...prev,
                                [req.id]: e.target.value,
                              }))
                            }
                            placeholder="Optional review note..."
                            className="mt-1.5 w-full max-w-xs px-2.5 py-1 rounded bg-[#070B12] border border-slate-800 text-[11px] text-white"
                          />
                        ) : (
                          req.admin_note && (
                            <div className="text-[11px] text-indigo-300 mt-0.5">
                              Admin: {req.admin_note}
                            </div>
                          )
                        )}
                      </td>
                      <td className="py-3.5 px-4 font-mono text-[11px] text-slate-400">
                        <div>{new Date(req.created_at).toLocaleString()}</div>
                        {req.reviewed_at && (
                          <div className="text-[10px] text-slate-500">
                            Reviewed {new Date(req.reviewed_at).toLocaleTimeString()}
                          </div>
                        )}
                      </td>
                      <td className="py-3.5 px-4 text-right">
                        {req.status === 'PENDING' && canReview ? (
                          <div className="inline-flex items-center gap-2">
                            <button
                              type="button"
                              disabled={busyId === req.id}
                              onClick={() => handleReview(req.id, true)}
                              title={
                                exceedsBalance
                                  ? 'Warning: Withdrawal amount exceeds user current balance'
                                  : 'Approve Request'
                              }
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 border border-emerald-500/30 text-xs font-medium cursor-pointer disabled:opacity-50"
                            >
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              <span>Approve</span>
                            </button>
                            <button
                              type="button"
                              disabled={busyId === req.id}
                              onClick={() => handleReview(req.id, false)}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 border border-rose-500/30 text-xs font-medium cursor-pointer disabled:opacity-50"
                            >
                              <XCircle className="w-3.5 h-3.5" />
                              <span>Reject</span>
                            </button>
                          </div>
                        ) : (
                          <span className="text-[11px] font-mono text-slate-500">
                            {req.status === 'PENDING' ? 'Read-Only' : 'Reviewed'}
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

      {/* Full-Screen Deposit Payment Proof Lightbox Modal */}
      <PaymentProofModal
        request={
          previewRequestId
            ? requests.find((r) => r.id === previewRequestId) || null
            : null
        }
        onClose={() => setPreviewRequestId(null)}
        formatMoney={formatMoney}
        canReview={canReview}
        busy={busyId === previewRequestId}
        adminNote={previewRequestId ? adminNotes[previewRequestId] || '' : ''}
        onAdminNoteChange={
          previewRequestId
            ? (val) =>
                setAdminNotes((prev) => ({
                  ...prev,
                  [previewRequestId]: val,
                }))
            : undefined
        }
        onApprove={async (id) => {
          await handleReview(id, true);
          setPreviewRequestId(null);
        }}
        onReject={async (id) => {
          await handleReview(id, false);
          setPreviewRequestId(null);
        }}
      />
    </div>
  );
}
