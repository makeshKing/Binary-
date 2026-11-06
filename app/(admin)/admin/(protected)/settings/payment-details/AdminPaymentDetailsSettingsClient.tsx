'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import {
  QrCode,
  Share2,
  Copy,
  Check,
  Save,
  ExternalLink,
  Smartphone,
  Building2,
  CheckCircle2,
  AlertCircle,
  ArrowLeft,
  Eye,
  EyeOff,
  MessageSquare,
} from 'lucide-react';
import {
  DEFAULT_MANUAL_PAYMENT_DETAILS,
  formatShareablePaymentText,
  getMethodLabel,
  ManualPaymentDetailsState,
  ManualPaymentMethodConfig,
  PaymentMethodCode,
} from '@/lib/payment-details';
import { useCurrency } from '@/components/CurrencyProvider';
import LoadingScreen from '@/components/LoadingScreen';

export default function AdminPaymentDetailsSettingsPage() {
  const { rate } = useCurrency();
  const [role, setRole] = useState<'SUPPORT' | 'ADMIN' | 'SUPERADMIN'>('ADMIN');
  const [state, setState] = useState<ManualPaymentDetailsState>(
    DEFAULT_MANUAL_PAYMENT_DETAILS
  );
  const [loading, setLoading] = useState<boolean>(true);
  const [saving, setSaving] = useState<boolean>(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{
    type: 'ok' | 'err';
    text: string;
  } | null>(null);

  const loadConfig = useCallback(async () => {
    setLoading(true);
    try {
      const [payRes, sessionRes] = await Promise.all([
        fetch('/api/payment-details', { cache: 'no-store' }),
        fetch('/api/admin/actions?view=dashboard&days=7', {
          cache: 'no-store',
        }),
      ]);

      const payContentType = payRes.headers.get('content-type') || '';
      if (payRes.ok && payContentType.includes('application/json')) {
        const payJson = await payRes.json();
        if (payJson?.paymentDetails) {
          setState(payJson.paymentDetails);
        }
      }
      const sessionContentType = sessionRes.headers.get('content-type') || '';
      if (sessionRes.ok && sessionContentType.includes('application/json')) {
        const sessionJson = await sessionRes.json();
        if (sessionJson?.session?.role) {
          setRole(sessionJson.session.role);
        }
      }
    } catch {
      // Fallback to default state if network or JSON parsing fails
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

  const canEdit = role === 'ADMIN' || role === 'SUPERADMIN';

  const getPublicPaymentUrl = (methodCode?: PaymentMethodCode) => {
    const origin =
      typeof window !== 'undefined' ? window.location.origin : '';
    const base = `${origin}/wallet/payment-details`;
    if (!methodCode) return base;
    return `${base}?method=${methodCode.toLowerCase()}`;
  };

  const handleCopy = async (text: string, key: string, successLabel: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      setFeedback({ type: 'ok', text: successLabel });
      setTimeout(() => setCopiedKey(null), 2000);
    } catch {
      setFeedback({ type: 'err', text: 'Clipboard copy failed.' });
    }
  };

  const handleMethodFieldChange = <K extends keyof ManualPaymentMethodConfig>(
    code: PaymentMethodCode,
    field: K,
    value: ManualPaymentMethodConfig[K]
  ) => {
    setState((prev) => ({
      ...prev,
      methods: {
        ...prev.methods,
        [code]: {
          ...prev.methods[code],
          [field]: value,
        },
      },
    }));
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canEdit) return;
    setSaving(true);
    setFeedback(null);

    try {
      const res = await fetch('/api/payment-details', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(state),
      });
      const contentType = res.headers.get('content-type') || '';
      const json = contentType.includes('application/json')
        ? await res.json()
        : null;
      if (!res.ok) {
        setFeedback({
          type: 'err',
          text: json?.error || 'Failed to save manual payment details.',
        });
      } else {
        if (json?.paymentDetails) {
          setState(json.paymentDetails);
        }
        setFeedback({
          type: 'ok',
          text: 'Manual payment details saved and published to the user Deposit Modal and Payment Details page.',
        });
      }
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Network error while saving.',
      });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <LoadingScreen
        variant="panel"
        label="Loading Manual Payment Channels"
        sublabel="Fetching eSewa, Khalti & Bank Transfer configuration..."
      />
    );
  }

  return (
    <div className="space-y-6">
      {/* Header & Quick Share Bar */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs text-slate-400 mb-1">
            <Link
              href="/admin/settings"
              className="hover:text-white inline-flex items-center gap-1"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Settings</span>
            </Link>
            <span>/</span>
            <span className="text-slate-300">Manual Payment Details</span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-white flex items-center gap-2.5">
            <QrCode className="w-6 h-6 text-emerald-400" />
            <span>Manual Payment Details &amp; User Sharing</span>
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            Configure Nepal local deposit accounts (eSewa, Khalti, Bank Transfer)
            and share the live Payment Details page or formatted instructions
            with users.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={() =>
              handleCopy(
                getPublicPaymentUrl(),
                'share-page-url',
                'User Payment Details page URL copied to clipboard!'
              )
            }
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold cursor-pointer"
          >
            {copiedKey === 'share-page-url' ? (
              <Check className="w-4 h-4" />
            ) : (
              <Share2 className="w-4 h-4" />
            )}
            <span>Copy Payment Page Link</span>
          </button>

          <button
            type="button"
            onClick={() =>
              handleCopy(
                formatShareablePaymentText(
                  state,
                  getPublicPaymentUrl(),
                  undefined,
                  rate
                ),
                'share-all-text',
                'Formatted payment instructions (all active methods) copied!'
              )
            }
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold cursor-pointer"
          >
            {copiedKey === 'share-all-text' ? (
              <Check className="w-4 h-4" />
            ) : (
              <Copy className="w-4 h-4" />
            )}
            <span>Share All Payment Details Text</span>
          </button>

          <Link
            href="/wallet/payment-details"
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-slate-700 bg-[#0B101B] hover:bg-slate-800 text-slate-200 text-xs font-semibold"
          >
            <span>Preview User Page</span>
            <ExternalLink className="w-3.5 h-3.5" />
          </Link>

          <Link
            href="/dashboard"
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-slate-700 bg-[#0B101B] hover:bg-slate-800 text-slate-300 hover:text-white text-xs font-semibold"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Trading Terminal</span>
          </Link>
        </div>
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

      {/* Shareable Method Quick-Copy Cards */}
      <div className="rounded-xl border border-slate-800/80 bg-[#0B101B] p-5 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-bold text-white">
              Quick Share Links &amp; Formatted Messages for Users
            </h2>
            <p className="text-xs text-slate-400">
              Send a direct link or formatted account block to any user in
              support chat, WhatsApp, Viber, or Telegram.
            </p>
          </div>
          <span className="text-[11px] font-mono text-slate-400 tabular-nums">
            Last updated: {new Date(state.updatedAt).toLocaleString()}
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-1">
          {(['ESEWA', 'KHALTI', 'BANK_TRANSFER'] as PaymentMethodCode[]).map(
            (code) => {
              const m = state.methods[code];
              return (
                <div
                  key={code}
                  className="p-3.5 rounded-xl border border-slate-800 bg-[#070B12] flex flex-col justify-between gap-3"
                >
                  <div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-bold text-white">
                        {m.name}
                      </span>
                      <span
                        className={`text-[10px] font-mono font-bold uppercase ${
                          m.enabled ? 'text-emerald-400' : 'text-amber-400'
                        }`}
                      >
                        {m.enabled ? 'Enabled' : 'Disabled'}
                      </span>
                    </div>
                    <div className="text-xs font-mono text-indigo-300 mt-1 tabular-nums">
                      {m.accountIdentifier}
                    </div>
                    <div className="text-[11px] text-slate-400 truncate">
                      {m.accountName}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 pt-2 border-t border-slate-800/80">
                    <button
                      type="button"
                      onClick={() =>
                        handleCopy(
                          getPublicPaymentUrl(code),
                          `link-${code}`,
                          `${getMethodLabel(code)} direct page link copied!`
                        )
                      }
                      className="flex-1 px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-[11px] font-semibold text-slate-200 flex items-center justify-center gap-1 cursor-pointer"
                    >
                      {copiedKey === `link-${code}` ? (
                        <Check className="w-3.5 h-3.5 text-emerald-400" />
                      ) : (
                        <Share2 className="w-3.5 h-3.5" />
                      )}
                      <span>Copy Link</span>
                    </button>

                    <button
                      type="button"
                      onClick={() =>
                        handleCopy(
                          formatShareablePaymentText(
                            state,
                            getPublicPaymentUrl(code),
                            code,
                            rate
                          ),
                          `text-${code}`,
                          `${getMethodLabel(code)} instructions copied!`
                        )
                      }
                      className="flex-1 px-2.5 py-1.5 rounded-lg bg-indigo-600/20 hover:bg-indigo-600/30 border border-indigo-500/30 text-[11px] font-semibold text-indigo-200 flex items-center justify-center gap-1 cursor-pointer"
                    >
                      {copiedKey === `text-${code}` ? (
                        <Check className="w-3.5 h-3.5 text-emerald-400" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" />
                      )}
                      <span>Copy Details</span>
                    </button>
                  </div>
                </div>
              );
            }
          )}
        </div>
      </div>

      {/* Main Configuration Form */}
      <form onSubmit={handleSave} className="space-y-6">
        {/* Deposit Details Visibility & Custom Deposit Message Card */}
        <div
          className={`rounded-xl border p-5 space-y-4 transition-colors ${
            state.hideDepositDetails
              ? 'border-amber-500/50 bg-amber-500/[0.06]'
              : 'border-slate-800/80 bg-[#0B101B]'
          }`}
        >
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-800/80">
            <div className="flex items-start gap-2.5">
              {state.hideDepositDetails ? (
                <EyeOff className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
              ) : (
                <Eye className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
              )}
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-sm font-bold text-white">
                    Deposit Details Visibility &amp; Custom Deposit Message
                  </h2>
                  <span
                    className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase ${
                      state.hideDepositDetails
                        ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                        : 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                    }`}
                  >
                    {state.hideDepositDetails
                      ? 'Deposit Details Hidden'
                      : 'Deposit Details Visible'}
                  </span>
                </div>
                <p className="text-xs text-slate-400 mt-0.5">
                  Hide receiving account numbers, holder names, and QR codes on
                  the user Deposit modal and Payment Details page, and display a
                  custom message for deposits.
                </p>
              </div>
            </div>

            {canEdit && (
              <div className="flex flex-wrap items-center gap-2.5 shrink-0">
                <button
                  type="button"
                  onClick={() =>
                    setState((prev) => ({
                      ...prev,
                      hideDepositDetails: !prev.hideDepositDetails,
                    }))
                  }
                  className={`px-3.5 py-2 rounded-xl text-xs font-bold flex items-center gap-2 transition-colors cursor-pointer ${
                    state.hideDepositDetails
                      ? 'bg-emerald-600 hover:bg-emerald-500 text-white'
                      : 'bg-amber-600 hover:bg-amber-500 text-white'
                  }`}
                >
                  {state.hideDepositDetails ? (
                    <>
                      <Eye className="w-4 h-4" />
                      <span>Show Deposit Details</span>
                    </>
                  ) : (
                    <>
                      <EyeOff className="w-4 h-4" />
                      <span>Hide Deposit Details</span>
                    </>
                  )}
                </button>

                <button
                  type="submit"
                  disabled={saving}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold cursor-pointer disabled:opacity-50"
                >
                  <Save className="w-3.5 h-3.5" />
                  <span>{saving ? 'Saving...' : 'Save Now'}</span>
                </button>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <label className="p-3 rounded-lg bg-[#070B12] border border-slate-800 flex items-start gap-2.5 text-xs text-slate-200 cursor-pointer">
              <input
                type="checkbox"
                disabled={!canEdit || loading}
                checked={Boolean(state.hideDepositDetails)}
                onChange={(e) =>
                  setState((prev) => ({
                    ...prev,
                    hideDepositDetails: e.target.checked,
                  }))
                }
                className="w-4 h-4 mt-0.5 accent-amber-500"
              />
              <div>
                <div className="font-bold text-white">
                  Hide All Deposit Account Details (eSewa, Khalti, Bank &amp; QR)
                </div>
                <div className="text-[11px] text-slate-400 mt-0.5">
                  When checked, users opening Deposit will not see payment
                  account numbers or QR codes and will instead see your Deposit
                  Message below.
                </div>
              </div>
            </label>

            <label className="p-3 rounded-lg bg-[#070B12] border border-slate-800 flex items-start gap-2.5 text-xs text-slate-200 cursor-pointer">
              <input
                type="checkbox"
                disabled={!canEdit || loading}
                checked={Boolean(state.showDepositMessageBanner)}
                onChange={(e) =>
                  setState((prev) => ({
                    ...prev,
                    showDepositMessageBanner: e.target.checked,
                  }))
                }
                className="w-4 h-4 mt-0.5 accent-emerald-500"
              />
              <div>
                <div className="font-bold text-white">
                  Also Show Deposit Message Banner When Details Are Visible
                </div>
                <div className="text-[11px] text-slate-400 mt-0.5">
                  When checked, your custom Deposit Message is highlighted at
                  the top of the Deposit screen even when payment details are
                  shown.
                </div>
              </div>
            </label>
          </div>

          <div>
            <div className="flex flex-wrap items-center justify-between gap-2 mb-1.5">
              <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-200">
                <MessageSquare className="w-3.5 h-3.5 text-amber-400" />
                <span>
                  Custom Deposit Message for Users (Shown when deposit details
                  are hidden or banner is active)
                </span>
              </label>

              {canEdit && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() =>
                      setState((prev) => ({
                        ...prev,
                        depositMessage:
                          'Manual deposit channels are currently undergoing scheduled maintenance. Please contact live support or check back shortly for updated deposit instructions.',
                      }))
                    }
                    className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-[10px] font-semibold text-slate-300 cursor-pointer"
                  >
                    Preset: Maintenance
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setState((prev) => ({
                        ...prev,
                        depositMessage:
                          'To make a deposit, please contact our official Support Desk with your 5-digit User ID to receive the active settlement account details.',
                      }))
                    }
                    className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-[10px] font-semibold text-slate-300 cursor-pointer"
                  >
                    Preset: Contact Support
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setState((prev) => ({
                        ...prev,
                        depositMessage:
                          'Notice: Please double-check the active receiving account number before transferring and always include your 5-digit User ID in payment remarks.',
                      }))
                    }
                    className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-[10px] font-semibold text-slate-300 cursor-pointer"
                  >
                    Preset: Verification Notice
                  </button>
                </div>
              )}
            </div>
            <textarea
              rows={3}
              disabled={!canEdit || loading}
              value={state.depositMessage || ''}
              onChange={(e) =>
                setState((prev) => ({
                  ...prev,
                  depositMessage: e.target.value,
                }))
              }
              placeholder="Enter the message users should see in the Deposit section..."
              className="w-full px-3.5 py-2.5 rounded-lg bg-[#070B12] border border-slate-800 focus:border-amber-500 focus:outline-none text-xs text-white leading-relaxed"
            />
          </div>
        </div>

        {/* Global Notice & Verification Policy */}
        <div className="rounded-xl border border-slate-800/80 bg-[#0B101B] p-5 space-y-4">
          <h2 className="text-sm font-bold text-white">
            Global Deposit Banner &amp; Verification Rules
          </h2>

          <div>
            <label className="block text-xs text-slate-300 mb-1">
              Support Contact / Processing Time Label
            </label>
            <input
              type="text"
              disabled={!canEdit || loading}
              value={state.supportContact}
              onChange={(e) =>
                setState((prev) => ({
                  ...prev,
                  supportContact: e.target.value,
                }))
              }
              className="w-full px-3 py-2 rounded-lg bg-[#070B12] border border-slate-800 text-xs text-white"
            />
          </div>

          <div>
            <label className="block text-xs text-slate-300 mb-1">
              Global Payment Instructions Banner (Shown at top of Payment Details
              page &amp; modal)
            </label>
            <textarea
              rows={2}
              disabled={!canEdit || loading}
              value={state.globalNotice}
              onChange={(e) =>
                setState((prev) => ({
                  ...prev,
                  globalNotice: e.target.value,
                }))
              }
              className="w-full px-3 py-2 rounded-lg bg-[#070B12] border border-slate-800 text-xs text-white"
            />
          </div>
        </div>

        {/* 3 Method Editors: eSewa, Khalti, Bank Transfer */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {(['ESEWA', 'KHALTI', 'BANK_TRANSFER'] as PaymentMethodCode[]).map(
            (code) => {
              const m = state.methods[code];
              return (
                <div
                  key={code}
                  className="rounded-xl border border-slate-800/80 bg-[#0B101B] p-5 space-y-4 flex flex-col justify-between"
                >
                  <div className="space-y-4">
                    <div className="flex items-center justify-between pb-3 border-b border-slate-800">
                      <div className="flex items-center gap-2">
                        {code === 'BANK_TRANSFER' ? (
                          <Building2 className="w-4 h-4 text-sky-400" />
                        ) : (
                          <Smartphone
                            className={`w-4 h-4 ${
                              code === 'ESEWA'
                                ? 'text-emerald-400'
                                : 'text-indigo-400'
                            }`}
                          />
                        )}
                        <h3 className="text-sm font-bold text-white">
                          {getMethodLabel(code)} Configuration
                        </h3>
                      </div>

                      <div className="flex items-center gap-3">
                        <label className="flex items-center gap-1.5 text-xs text-amber-300 cursor-pointer">
                          <input
                            type="checkbox"
                            disabled={!canEdit}
                            checked={Boolean(m.hideDetails)}
                            onChange={(e) =>
                              handleMethodFieldChange(
                                code,
                                'hideDetails',
                                e.target.checked
                              )
                            }
                            className="w-3.5 h-3.5 accent-amber-500"
                          />
                          <span>Hide Details</span>
                        </label>

                        <label className="flex items-center gap-1.5 text-xs text-slate-300 cursor-pointer">
                          <input
                            type="checkbox"
                            disabled={!canEdit}
                            checked={m.enabled}
                            onChange={(e) =>
                              handleMethodFieldChange(
                                code,
                                'enabled',
                                e.target.checked
                              )
                            }
                            className="w-4 h-4 accent-emerald-500"
                          />
                          <span>Active</span>
                        </label>
                      </div>
                    </div>

                    {m.hideDetails && (
                      <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 space-y-2">
                        <label className="block text-[11px] font-semibold text-amber-200">
                          Custom Message for {getMethodLabel(code)} (Optional —
                          uses global Deposit Message if blank)
                        </label>
                        <textarea
                          rows={2}
                          disabled={!canEdit}
                          value={m.customMessage || ''}
                          onChange={(e) =>
                            handleMethodFieldChange(
                              code,
                              'customMessage',
                              e.target.value
                            )
                          }
                          placeholder={`Message shown when ${getMethodLabel(code)} account details are hidden...`}
                          className="w-full px-2.5 py-1.5 rounded bg-[#070B12] border border-amber-500/30 text-xs text-white"
                        />
                      </div>
                    )}

                    <div>
                      <label className="block text-xs text-slate-400 mb-1">
                        Display Title
                      </label>
                      <input
                        type="text"
                        disabled={!canEdit}
                        value={m.name}
                        onChange={(e) =>
                          handleMethodFieldChange(code, 'name', e.target.value)
                        }
                        className="w-full px-3 py-2 rounded-lg bg-[#070B12] border border-slate-800 text-xs text-white"
                      />
                    </div>

                    <div>
                      <label className="block text-xs text-slate-400 mb-1">
                        Account Holder / Merchant Name
                      </label>
                      <input
                        type="text"
                        disabled={!canEdit}
                        value={m.accountName}
                        onChange={(e) =>
                          handleMethodFieldChange(
                            code,
                            'accountName',
                            e.target.value
                          )
                        }
                        className="w-full px-3 py-2 rounded-lg bg-[#070B12] border border-slate-800 text-xs text-white"
                      />
                    </div>

                    <div>
                      <label className="block text-xs text-slate-400 mb-1">
                        {code === 'BANK_TRANSFER'
                          ? 'Bank Account Number'
                          : `${getMethodLabel(code)} Wallet ID / Phone Number`}
                      </label>
                      <input
                        type="text"
                        disabled={!canEdit}
                        value={m.accountIdentifier}
                        onChange={(e) =>
                          handleMethodFieldChange(
                            code,
                            'accountIdentifier',
                            e.target.value
                          )
                        }
                        className="w-full px-3 py-2 rounded-lg bg-[#070B12] border border-slate-800 text-xs font-mono font-bold text-emerald-400"
                      />
                    </div>

                    {code === 'BANK_TRANSFER' && (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                          <label className="block text-xs text-slate-400 mb-1">
                            Bank Name
                          </label>
                          <input
                            type="text"
                            disabled={!canEdit}
                            value={m.bankName || ''}
                            onChange={(e) =>
                              handleMethodFieldChange(
                                code,
                                'bankName',
                                e.target.value
                              )
                            }
                            className="w-full px-3 py-2 rounded-lg bg-[#070B12] border border-slate-800 text-xs text-white"
                          />
                        </div>
                        <div>
                          <label className="block text-xs text-slate-400 mb-1">
                            Branch Name
                          </label>
                          <input
                            type="text"
                            disabled={!canEdit}
                            value={m.branchName || ''}
                            onChange={(e) =>
                              handleMethodFieldChange(
                                code,
                                'branchName',
                                e.target.value
                              )
                            }
                            className="w-full px-3 py-2 rounded-lg bg-[#070B12] border border-slate-800 text-xs text-white"
                          />
                        </div>
                      </div>
                    )}

                    <div>
                      <label className="block text-xs text-slate-400 mb-1">
                        Custom QR Code Image URL (Optional — Auto-generates QR if
                        blank)
                      </label>
                      <input
                        type="url"
                        disabled={!canEdit}
                        value={m.qrCodeUrl || ''}
                        onChange={(e) =>
                          handleMethodFieldChange(
                            code,
                            'qrCodeUrl',
                            e.target.value
                          )
                        }
                        placeholder="https://... (Optional custom QR image)"
                        className="w-full px-3 py-2 rounded-lg bg-[#070B12] border border-slate-800 text-xs text-white"
                      />
                    </div>

                    <div>
                      <label className="block text-xs text-slate-400 mb-1">
                        Step-by-Step User Instructions
                      </label>
                      <textarea
                        rows={3}
                        disabled={!canEdit}
                        value={m.instructions}
                        onChange={(e) =>
                          handleMethodFieldChange(
                            code,
                            'instructions',
                            e.target.value
                          )
                        }
                        className="w-full px-3 py-2 rounded-lg bg-[#070B12] border border-slate-800 text-xs text-white"
                      />
                    </div>
                  </div>
                </div>
              );
            }
          )}
        </div>

        {canEdit ? (
          <div className="flex items-center justify-end">
            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold cursor-pointer disabled:opacity-50"
            >
              <Save className="w-4 h-4" />
              <span>
                {saving
                  ? 'Saving & Publishing...'
                  : 'Save & Publish Payment Details'}
              </span>
            </button>
          </div>
        ) : (
          <div className="text-xs font-mono text-slate-400">
            Read-only mode: ADMIN or SUPERADMIN role is required to modify
            receiving payment accounts. You can still copy and share payment
            links above.
          </div>
        )}
      </form>
    </div>
  );
}
