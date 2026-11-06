'use client';

import React, { useEffect, useState, useCallback, useRef } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  Wallet,
  Copy,
  Check,
  QrCode,
  Building2,
  Smartphone,
  CheckCircle2,
  AlertCircle,
  Clock,
  ExternalLink,
  ShieldCheck,
  Loader2,
  FileText,
  Send,
  Upload,
  Image as ImageIcon,
  Trash2,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import {
  isSupabaseConfigured,
  ProfileRow,
  resolveUserNumber,
  UserStatus,
  WalletRequestRow,
} from '@/lib/supabase/types';
import { isRealAuthenticatedUser } from '@/lib/supabase/auth-utils';
import {
  CurrencyToggleButton,
  useCurrency,
} from '@/components/CurrencyProvider';
import {
  CurrencyCode,
  fromBaseToInputString,
  getLimitsInCurrency,
} from '@/lib/currency';
import {
  buildPaymentProofNote,
  DEFAULT_MANUAL_PAYMENT_DETAILS,
  getMethodLabel,
  ManualPaymentDetailsState,
  parsePaymentProofFromNote,
  PaymentMethodCode,
  uploadPaymentProofScreenshot,
  validatePaymentProofFile,
} from '@/lib/payment-details';
import { ToastBanner } from '@/components/BalanceBadge';
import LoadingScreen from '@/components/LoadingScreen';

const DEPOSIT_PRESETS_USDT = [100, 500, 1000, 5000] as const;

function SimulatedQrGraphic({
  code,
  identifier,
  accountName,
}: {
  code: PaymentMethodCode;
  identifier: string;
  accountName: string;
}) {
  const accentColor =
    code === 'ESEWA'
      ? '#22ab68'
      : code === 'KHALTI'
        ? '#6366f1'
        : '#3898ff';

  // Deterministic 9x9 matrix from identifier string
  const seedStr = `${code}:${identifier}:${accountName}`;
  const cells: boolean[] = [];
  for (let i = 0; i < 81; i++) {
    const ch = seedStr.charCodeAt(i % seedStr.length) + i * 17;
    cells.push(ch % 2 === 0 || i % 7 === 0);
  }

  return (
    <div className="bg-white p-3 rounded-xl inline-flex flex-col items-center shadow-md border border-slate-200">
      <div className="relative w-36 h-36 grid grid-cols-9 gap-0.5 p-1.5 bg-white border-2 border-slate-900 rounded-lg">
        {cells.map((filled, idx) => {
          const row = Math.floor(idx / 9);
          const col = idx % 9;
          const isCorner =
            (row < 3 && col < 3) ||
            (row < 3 && col > 5) ||
            (row > 5 && col < 3);
          return (
            <div
              key={idx}
              style={{
                backgroundColor: isCorner
                  ? accentColor
                  : filled
                    ? '#0f172a'
                    : '#f8fafc',
              }}
              className="w-full h-full rounded-[1px]"
            />
          );
        })}
      </div>
      <div className="mt-1.5 text-[10px] font-mono font-bold text-slate-800 tracking-tight">
        {getMethodLabel(code)} · {identifier}
      </div>
    </div>
  );
}

export default function ManualPaymentDetailsPage() {
  const configured = isSupabaseConfigured();
  const { currency, rate, isFading, formatMoney, toBase } = useCurrency();

  const [paymentDetails, setPaymentDetails] =
    useState<ManualPaymentDetailsState>(DEFAULT_MANUAL_PAYMENT_DETAILS);
  const [selectedMethod, setSelectedMethod] =
    useState<PaymentMethodCode>('ESEWA');

  const [userId, setUserId] = useState<string | null>(null);
  const [userNumber, setUserNumber] = useState<number | null>(null);
  const [userStatus, setUserStatus] = useState<UserStatus>('ACTIVE');
  const [balance, setBalance] = useState<number>(0);
  const [requests, setRequests] = useState<WalletRequestRow[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

  // Payment Proof Form State
  const [depositAmount, setDepositAmount] = useState<string>('500');
  const [proofFile, setProofFile] = useState<File | null>(null);
  const [proofPreview, setProofPreview] = useState<string | null>(null);
  const proofFileInputRef = useRef<HTMLInputElement | null>(null);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [toast, setToast] = useState<{
    type: 'success' | 'error' | 'info';
    message: string;
  } | null>(null);

  const prevCurrencyRef = useRef<CurrencyCode>(currency);
  const lastBaseUsdtRef = useRef<number>(500);
  const depositConversion = toBase(depositAmount);
  const baseUsdtAmount = depositConversion.baseUsdt;

  useEffect(() => {
    if (Number.isFinite(baseUsdtAmount) && baseUsdtAmount > 0) {
      lastBaseUsdtRef.current = baseUsdtAmount;
    }
  }, [baseUsdtAmount]);

  useEffect(() => {
    if (prevCurrencyRef.current !== currency) {
      const nextStr = fromBaseToInputString(
        lastBaseUsdtRef.current || 500,
        currency,
        rate
      );
      setDepositAmount(nextStr.endsWith('.00') ? nextStr.slice(0, -3) : nextStr);
      prevCurrencyRef.current = currency;
    }
  }, [currency, rate]);

  // Read optional ?method=esewa|khalti|bank_transfer from URL
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const rawMethod = (params.get('method') || '').toUpperCase();
      if (rawMethod === 'ESEWA') setSelectedMethod('ESEWA');
      else if (rawMethod === 'KHALTI') setSelectedMethod('KHALTI');
      else if (rawMethod === 'BANK_TRANSFER' || rawMethod === 'BANK') {
        setSelectedMethod('BANK_TRANSFER');
      }
    }
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  const loadData = useCallback(async () => {
    try {
      const res = await fetch('/api/payment-details', { cache: 'no-store' });
      const contentType = res.headers.get('content-type') || '';
      if (res.ok && contentType.includes('application/json')) {
        const json = await res.json();
        if (json?.paymentDetails) {
          setPaymentDetails(json.paymentDetails);
          const methods = json.paymentDetails.methods as Record<
            PaymentMethodCode,
            { enabled: boolean }
          >;
          if (methods && !methods[selectedMethod]?.enabled) {
            const firstEnabled = (
              ['ESEWA', 'KHALTI', 'BANK_TRANSFER'] as PaymentMethodCode[]
            ).find((c) => methods[c]?.enabled);
            if (firstEnabled) setSelectedMethod(firstEnabled);
          }
        }
      }
    } catch {
      // Keep default payment details on network error
    }

    if (!configured) {
      setLoading(false);
      return;
    }

    try {
      const supabase = createClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();
      let activeUser = session?.user ?? null;
      if (!activeUser) {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        activeUser = user;
      }

      if (!activeUser || !isRealAuthenticatedUser(activeUser)) {
        setUserId(null);
        setLoading(false);
        return;
      }

      setUserId(activeUser.id);

      const [profileRes, reqsRes] = await Promise.all([
        supabase
          .from('profiles')
          .select('*')
          .eq('id', activeUser.id)
          .maybeSingle(),
        supabase
          .from('wallet_requests')
          .select('*')
          .eq('user_id', activeUser.id)
          .eq('type', 'DEPOSIT')
          .order('created_at', { ascending: false })
          .limit(25),
      ]);

      if (profileRes.data) {
        const prof = profileRes.data as ProfileRow;
        setBalance(Number(prof.balance));
        setUserNumber(resolveUserNumber(prof.user_number, prof.id));
        setUserStatus((prof.status as UserStatus) || 'ACTIVE');
      } else {
        setUserNumber(resolveUserNumber(null, activeUser.id));
      }

      if (reqsRes.data) {
        setRequests(reqsRes.data as WalletRequestRow[]);
      }
    } finally {
      setLoading(false);
    }
  }, [configured, selectedMethod]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleCopy = async (text: string, label: string) => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopiedField(label);
      setToast({ type: 'success', message: `${label} copied to clipboard` });
      setTimeout(() => setCopiedField(null), 2000);
    } catch {
      setToast({ type: 'info', message: `${label}: ${text}` });
    }
  };

  const displayUserNumber = resolveUserNumber(userNumber, userId);
  const pendingRequestsCount = requests.filter(
    (r) => r.status === 'PENDING'
  ).length;
  const isBlocked =
    userStatus === 'SUSPENDED' || userStatus === 'DISABLED';

  const depositLimits = getLimitsInCurrency(
    10,
    10000,
    DEPOSIT_PRESETS_USDT,
    currency,
    rate
  );

  const activeMethodConfig =
    paymentDetails.methods[selectedMethod] ||
    DEFAULT_MANUAL_PAYMENT_DETAILS.methods.ESEWA;

  const equivalentNpr = Number((baseUsdtAmount * (rate || 134.5)).toFixed(2));

  const handleSubmitProof = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);

    if (isBlocked) {
      const msg = `Your account status is ${userStatus}. Only ACTIVE accounts can submit deposit requests.`;
      setErrorMsg(msg);
      setToast({ type: 'error', message: msg });
      return;
    }

    const rawInputNum = Number(depositAmount);
    if (
      !Number.isFinite(rawInputNum) ||
      !/^\d+(\.\d{1,2})?$/.test(depositAmount.trim())
    ) {
      const msg = 'Deposit amount can have at most 2 decimal places.';
      setErrorMsg(msg);
      setToast({ type: 'error', message: msg });
      return;
    }

    if (baseUsdtAmount < 10 || baseUsdtAmount > 10000) {
      const msg = `Deposit amount must be between ${depositLimits.minDisplayFormatted} and ${depositLimits.maxDisplayFormatted} ($10.00 – $10,000.00 USDT).`;
      setErrorMsg(msg);
      setToast({ type: 'error', message: msg });
      return;
    }

    const proofError = validatePaymentProofFile(proofFile);
    if (proofError || !proofFile) {
      const msg =
        proofError ||
        'Please upload your payment proof screenshot image (Max 2 MB).';
      setErrorMsg(msg);
      setToast({ type: 'error', message: msg });
      return;
    }

    if (pendingRequestsCount >= 3) {
      const msg =
        'You already have 3 pending deposit requests. Please wait for admin verification.';
      setErrorMsg(msg);
      setToast({ type: 'error', message: msg });
      return;
    }

    if (!configured) {
      const msg = 'Supabase environment variables are not configured.';
      setErrorMsg(msg);
      setToast({ type: 'error', message: msg });
      return;
    }

    const currencySuffix =
      currency === 'NPR' && rate
        ? `[Entered as ${depositConversion.exactDisplayFormatted} @ ${rate.toFixed(
            2
          )} = $${baseUsdtAmount.toFixed(2)} USDT]`
        : `[NPR Eq: Rs ${equivalentNpr.toLocaleString('en-US', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          })} @ ${(rate || 134.5).toFixed(2)}]`;

    setSubmitting(true);
    try {
      const uploadedProofUrl = await uploadPaymentProofScreenshot(
        proofFile,
        proofPreview
      );
      const formattedNote = buildPaymentProofNote({
        userNumber: displayUserNumber || null,
        methodCode: selectedMethod,
        screenshotUrl: uploadedProofUrl,
        currencySuffix,
      });

      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user || !isRealAuthenticatedUser(user)) {
        const msg = 'Authentication required. Please log in again.';
        setErrorMsg(msg);
        setToast({ type: 'error', message: msg });
        return;
      }

      const { data, error } = await supabase.rpc('request_deposit', {
        p_amount: Number(baseUsdtAmount.toFixed(2)),
        p_note: formattedNote,
      });

      if (error) {
        setErrorMsg(error.message || 'Failed to submit manual payment proof.');
        setToast({
          type: 'error',
          message: error.message || 'Failed to submit manual payment proof.',
        });
      } else {
        const created = data as WalletRequestRow | null;
        if (created) {
          setRequests((prev) => [
            {
              ...created,
              user_number: created.user_number ?? displayUserNumber,
            },
            ...prev,
          ]);
        }
        setProofFile(null);
        setProofPreview(null);
        if (proofFileInputRef.current) {
          proofFileInputRef.current.value = '';
        }
        const okText = `Payment proof (${getMethodLabel(
          selectedMethod
        )}) submitted for admin verification!`;
        setSuccessMsg(okText);
        setToast({ type: 'success', message: okText });
        await loadData();
      }
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : 'Unexpected network error while submitting payment proof.';
      setErrorMsg(msg);
      setToast({ type: 'error', message: msg });
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <LoadingScreen
        variant="fullscreen"
        label="Loading Official Payment Channels"
        sublabel="Fetching eSewa, Khalti & Bank Transfer account details..."
      />
    );
  }

  return (
    <div className="flex-1 bg-[#171a23] text-slate-100 flex flex-col min-h-screen">
      {/* Top Bar */}
      <header className="h-14 bg-[#1c202b] border-b border-[#262b38] px-4 lg:px-6 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <Link
            href="/wallet"
            prefetch={false}
            className="flex items-center gap-1.5 text-xs font-bold text-[#8c94ab] hover:text-white transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Wallet</span>
          </Link>
          <span className="text-[#2e3446]" aria-hidden="true">
            /
          </span>
          <div className="flex items-center gap-2 min-w-0">
            <QrCode className="w-4 h-4 text-[#22ab68] shrink-0" />
            <h1 className="text-sm font-bold text-white truncate">
              Manual Payment Details (Nepal Local)
            </h1>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          <CurrencyToggleButton />

          {displayUserNumber > 0 && (
            <button
              type="button"
              onClick={() =>
                handleCopy(String(displayUserNumber), '5-Digit User ID')
              }
              className="px-2.5 py-1.5 rounded-lg bg-[#141722] hover:bg-[#232838] border border-[#2e3446] text-xs font-mono font-bold text-slate-200 flex items-center gap-1.5 cursor-pointer"
              title="Copy your 5-digit User ID for payment remarks"
            >
              <span>
                User ID:{' '}
                <span className="text-[#3898ff]">{displayUserNumber}</span>
              </span>
              {copiedField === '5-Digit User ID' ? (
                <Check className="w-3.5 h-3.5 text-[#22ab68]" />
              ) : (
                <Copy className="w-3.5 h-3.5 text-[#8c94ab]" />
              )}
            </button>
          )}

          <Link
            href="/dashboard"
            prefetch={false}
            className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#252a3a] hover:bg-[#2f364a] text-xs font-bold text-slate-200"
          >
            <span>Trading Terminal</span>
          </Link>
        </div>
      </header>

      <div className="max-w-6xl w-full mx-auto px-4 lg:px-6 py-6 space-y-6">
        {/* Global Admin Notice Banner */}
        <div className="rounded-xl bg-[#1c202b] border border-[#2e3446] p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <ShieldCheck className="w-5 h-5 text-[#22ab68] shrink-0 mt-0.5" />
            <div className="space-y-1">
              <div className="text-xs font-bold text-white flex flex-wrap items-center gap-2">
                <span>Official Nepal Manual Deposit Channels</span>
                <span aria-hidden="true" className="text-[#7c849b]">
                  ·
                </span>
                <span className="font-mono text-[#22ab68]">
                  {paymentDetails.supportContact}
                </span>
              </div>
              <p className="text-xs text-[#9aa3ba] leading-relaxed">
                {paymentDetails.globalNotice}
              </p>
            </div>
          </div>
        </div>

        {/* Custom Admin Deposit Message Banner (when details are hidden OR banner is enabled) */}
        {(paymentDetails.hideDepositDetails ||
          (paymentDetails.showDepositMessageBanner &&
            paymentDetails.depositMessage?.trim())) && (
          <div className="rounded-xl bg-amber-500/10 border border-amber-500/40 p-5 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-sm font-bold text-amber-300 flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
                <span>
                  {paymentDetails.hideDepositDetails
                    ? 'Deposit Notice from Administrator'
                    : 'Important Deposit Message'}
                </span>
              </div>
              <span className="text-xs font-mono text-amber-200/80">
                {paymentDetails.supportContact}
              </span>
            </div>
            <p className="text-xs sm:text-sm text-slate-100 leading-relaxed whitespace-pre-line">
              {paymentDetails.depositMessage?.trim() ||
                'Manual deposit account details are temporarily hidden by the administrator. Please contact support or check back shortly for updated deposit instructions.'}
            </p>
          </div>
        )}

        {/* Method Selector Tabs: eSewa / Khalti / Bank Transfer */}
        {!paymentDetails.hideDepositDetails && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {(['ESEWA', 'KHALTI', 'BANK_TRANSFER'] as PaymentMethodCode[]).map(
              (code) => {
                const m = paymentDetails.methods[code];
                const isSelected = selectedMethod === code;
                const accentBorder =
                  code === 'ESEWA'
                    ? isSelected
                      ? 'border-[#22ab68] bg-[#22ab68]/10'
                      : 'border-[#2e3446] bg-[#1c202b] hover:border-[#22ab68]/50'
                    : code === 'KHALTI'
                      ? isSelected
                        ? 'border-indigo-500 bg-indigo-500/10'
                        : 'border-[#2e3446] bg-[#1c202b] hover:border-indigo-500/50'
                      : isSelected
                        ? 'border-[#3898ff] bg-[#3898ff]/10'
                        : 'border-[#2e3446] bg-[#1c202b] hover:border-[#3898ff]/50';

                return (
                  <button
                    key={code}
                    type="button"
                    onClick={() => setSelectedMethod(code)}
                    className={`p-4 rounded-xl border text-left transition-all cursor-pointer flex items-start justify-between gap-3 ${accentBorder}`}
                  >
                    <div className="space-y-1 min-w-0">
                      <div className="flex items-center gap-2">
                        {code === 'BANK_TRANSFER' ? (
                          <Building2 className="w-4 h-4 text-[#3898ff] shrink-0" />
                        ) : (
                          <Smartphone
                            className={`w-4 h-4 shrink-0 ${
                              code === 'ESEWA'
                                ? 'text-[#22ab68]'
                                : 'text-indigo-400'
                            }`}
                          />
                        )}
                        <span className="text-sm font-bold text-white truncate">
                          {m.name}
                        </span>
                      </div>
                      <p className="text-[11px] text-[#8c94ab] truncate">
                        {m.subtitle}
                      </p>
                      <div className="pt-1 font-mono text-xs font-bold text-slate-200 tabular-nums truncate">
                        {m.hideDetails
                          ? 'Details Hidden by Admin'
                          : m.accountIdentifier}
                      </div>
                    </div>

                    <span
                      className={`text-[10px] font-mono font-bold uppercase shrink-0 ${
                        m.hideDetails
                          ? 'text-amber-400'
                          : m.enabled
                            ? 'text-[#22ab68]'
                            : 'text-amber-400'
                      }`}
                    >
                      {m.hideDetails
                        ? 'Notice'
                        : m.enabled
                          ? 'Active'
                          : 'Paused'}
                    </span>
                  </button>
                );
              }
            )}
          </div>
        )}

        {/* Main 2-Column Grid: Left = Payment Account Details & QR, Right = Submit Payment Proof Form */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* LEFT COLUMN (7 cols): Selected Payment Method Details & QR Code */}
          <section className="lg:col-span-7 bg-[#1c202b] border border-[#2e3446] rounded-xl p-5 sm:p-6 space-y-5 flex flex-col justify-between">
            {paymentDetails.hideDepositDetails ||
            activeMethodConfig.hideDetails ? (
              <div className="space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2 pb-4 border-b border-[#262b38]">
                  <div>
                    <div className="text-[11px] font-mono uppercase text-amber-400">
                      Step 1 · Deposit Information &amp; Notice
                    </div>
                    <h2 className="text-base font-bold text-white mt-0.5">
                      {paymentDetails.hideDepositDetails
                        ? 'Deposit Account Details Hidden by Administrator'
                        : `${activeMethodConfig.name} — Notice`}
                    </h2>
                  </div>
                </div>

                <div className="p-5 rounded-xl bg-[#141722] border border-amber-500/35 space-y-3">
                  <div className="flex items-center gap-2 text-xs font-bold text-amber-300">
                    <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
                    <span>Official Deposit Message</span>
                  </div>
                  <p className="text-xs sm:text-sm text-slate-200 leading-relaxed whitespace-pre-line">
                    {(activeMethodConfig.hideDetails &&
                      activeMethodConfig.customMessage?.trim()) ||
                      paymentDetails.depositMessage?.trim() ||
                      'Manual deposit account details are temporarily hidden by the administrator. Please contact support or check back shortly for updated deposit instructions.'}
                  </p>
                  <div className="pt-2 border-t border-[#262b38] flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono text-[#8c94ab]">
                    <span>{paymentDetails.supportContact}</span>
                    <span>
                      Your Account Reference: User ID{' '}
                      <strong className="text-[#3898ff]">
                        {displayUserNumber || '—'}
                      </strong>
                    </span>
                  </div>
                </div>
              </div>
            ) : (
              <div className="space-y-5">
                <div className="flex flex-wrap items-center justify-between gap-2 pb-4 border-b border-[#262b38]">
                  <div>
                    <div className="text-[11px] font-mono uppercase text-[#8c94ab]">
                      Step 1 · Send Payment To Official Account
                    </div>
                    <h2 className="text-base font-bold text-white mt-0.5">
                      {activeMethodConfig.name} ({getMethodLabel(selectedMethod)}
                      )
                    </h2>
                  </div>
                  <div className="text-xs font-mono text-[#8c94ab] tabular-nums">
                    Est. Verification: {activeMethodConfig.processingTime}
                  </div>
                </div>

                {/* Account Details Rows with Copy Buttons */}
                <div className="space-y-3">
                  {/* Account Holder Name */}
                  <div className="p-3.5 rounded-xl bg-[#141722] border border-[#262b38] flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-[11px] text-[#8c94ab]">
                        Account Holder / Merchant Name
                      </div>
                      <div className="text-sm font-bold text-white truncate mt-0.5">
                        {activeMethodConfig.accountName}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        handleCopy(
                          activeMethodConfig.accountName,
                          'Account Name'
                        )
                      }
                      className="px-3 py-1.5 rounded-lg bg-[#252a3a] hover:bg-[#30374c] text-xs font-semibold text-slate-200 flex items-center gap-1.5 shrink-0 cursor-pointer"
                    >
                      {copiedField === 'Account Name' ? (
                        <>
                          <Check className="w-3.5 h-3.5 text-[#22ab68]" />
                          <span>Copied</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-3.5 h-3.5" />
                          <span>Copy</span>
                        </>
                      )}
                    </button>
                  </div>

                  {/* Wallet ID / Bank Account Number */}
                  <div className="p-3.5 rounded-xl bg-[#141722] border border-[#2a3146] flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-[11px] text-[#8c94ab]">
                        {selectedMethod === 'BANK_TRANSFER'
                          ? 'Bank Account Number'
                          : `${getMethodLabel(selectedMethod)} Wallet ID / Mobile Number`}
                      </div>
                      <div className="text-base font-mono font-extrabold text-[#22ab68] tabular-nums mt-0.5 break-all">
                        {activeMethodConfig.accountIdentifier}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        handleCopy(
                          activeMethodConfig.accountIdentifier,
                          `${getMethodLabel(selectedMethod)} Number`
                        )
                      }
                      className="px-3 py-1.5 rounded-lg bg-[#22ab68] hover:bg-[#1e995d] text-xs font-bold text-white flex items-center gap-1.5 shrink-0 cursor-pointer"
                    >
                      {copiedField ===
                      `${getMethodLabel(selectedMethod)} Number` ? (
                        <>
                          <Check className="w-3.5 h-3.5" />
                          <span>Copied</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-3.5 h-3.5" />
                          <span>Copy Number</span>
                        </>
                      )}
                    </button>
                  </div>

                  {/* Bank Name & Branch (for Bank Transfer) */}
                  {selectedMethod === 'BANK_TRANSFER' && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="p-3.5 rounded-xl bg-[#141722] border border-[#262b38] flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <div className="text-[11px] text-[#8c94ab]">
                            Bank Name
                          </div>
                          <div className="text-xs font-bold text-white truncate mt-0.5">
                            {activeMethodConfig.bankName || 'Nabil Bank Limited'}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() =>
                            handleCopy(
                              activeMethodConfig.bankName ||
                                'Nabil Bank Limited',
                              'Bank Name'
                            )
                          }
                          className="p-1.5 rounded-lg bg-[#252a3a] hover:bg-[#30374c] text-slate-300 cursor-pointer"
                          title="Copy Bank Name"
                        >
                          <Copy className="w-3.5 h-3.5" />
                        </button>
                      </div>

                      <div className="p-3.5 rounded-xl bg-[#141722] border border-[#262b38] flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <div className="text-[11px] text-[#8c94ab]">
                            Branch
                          </div>
                          <div className="text-xs font-bold text-white truncate mt-0.5">
                            {activeMethodConfig.branchName || 'Kathmandu Branch'}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() =>
                            handleCopy(
                              activeMethodConfig.branchName ||
                                'Kathmandu Branch',
                              'Branch Name'
                            )
                          }
                          className="p-1.5 rounded-lg bg-[#252a3a] hover:bg-[#30374c] text-slate-300 cursor-pointer"
                          title="Copy Branch Name"
                        >
                          <Copy className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                {/* QR Code & Instructions Box */}
                <div className="p-4 rounded-xl bg-[#141722] border border-[#262b38] flex flex-col sm:flex-row items-center gap-5">
                  <div className="shrink-0">
                    {activeMethodConfig.qrCodeUrl ? (
                      <div className="bg-white p-2.5 rounded-xl shadow-md border border-slate-200 inline-block">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={activeMethodConfig.qrCodeUrl}
                          alt={`${activeMethodConfig.name} QR Code`}
                          className="w-36 h-36 object-contain rounded"
                          referrerPolicy="no-referrer"
                        />
                      </div>
                    ) : (
                      <SimulatedQrGraphic
                        code={selectedMethod}
                        identifier={activeMethodConfig.accountIdentifier}
                        accountName={activeMethodConfig.accountName}
                      />
                    )}
                  </div>

                  <div className="space-y-2.5 text-xs">
                    <div className="font-bold text-white">
                      How to Complete Your {getMethodLabel(selectedMethod)}{' '}
                      Deposit:
                    </div>
                    <p className="text-[#9aa3ba] leading-relaxed">
                      {activeMethodConfig.instructions}
                    </p>
                    <div className="pt-1 space-y-1 font-mono text-[11px] text-slate-300 tabular-nums">
                      <div>
                        • Exchange Rate:{' '}
                        <span className="font-bold text-white">
                          1 USDT = Rs {(rate || 134.5).toFixed(2)} NPR
                        </span>
                      </div>
                      <div>
                        • Method Limits:{' '}
                        <span className="font-bold text-white">
                          Rs{' '}
                          {activeMethodConfig.minAmountNpr.toLocaleString(
                            'en-US'
                          )}{' '}
                          – Rs{' '}
                          {activeMethodConfig.maxAmountNpr.toLocaleString(
                            'en-US'
                          )}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Bottom Summary Strip */}
            <div className="pt-4 border-t border-[#262b38] flex flex-wrap items-center justify-between gap-2 text-xs text-[#8c94ab]">
              <span>
                Current Wallet Balance:{' '}
                <strong
                  className={`font-mono text-white tabular-nums ${
                    isFading ? 'opacity-30' : 'opacity-100'
                  }`}
                >
                  {formatMoney(balance)}
                </strong>
              </span>
              <span>
                Active Pending Deposits:{' '}
                <strong className="font-mono text-[#f59e0b] tabular-nums">
                  {pendingRequestsCount} / 3
                </strong>
              </span>
            </div>
          </section>

          {/* RIGHT COLUMN (5 cols): Step 2 Submit Payment Proof Form */}
          <section className="lg:col-span-5 bg-[#1c202b] border border-[#2e3446] rounded-xl p-5 sm:p-6 space-y-4">
            <div className="pb-3 border-b border-[#262b38]">
              <div className="text-[11px] font-mono uppercase text-[#22ab68]">
                Step 2 · Upload Payment Screenshot
              </div>
              <h2 className="text-base font-bold text-white mt-0.5">
                Submit Payment Proof
              </h2>
              <p className="text-xs text-[#8c94ab] mt-1">
                After transferring via eSewa, Khalti, or Bank, upload your
                payment proof screenshot (Max 2 MB) below.
              </p>
            </div>

            {errorMsg && (
              <div className="p-3 rounded-xl bg-[#e34c3b]/15 border border-[#e34c3b]/40 text-xs text-red-200 flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-[#e34c3b] shrink-0 mt-0.5" />
                <span>{errorMsg}</span>
              </div>
            )}

            {successMsg && (
              <div className="p-3.5 rounded-xl bg-[#22ab68]/15 border border-[#22ab68]/40 text-xs text-emerald-100 flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 text-[#22ab68] shrink-0 mt-0.5" />
                <div>
                  <div className="font-bold text-white">{successMsg}</div>
                  <div className="text-[11px] text-emerald-200/90 mt-0.5">
                    Your balance will update automatically as soon as an admin
                    verifies your {getMethodLabel(selectedMethod)} payment proof.
                  </div>
                </div>
              </div>
            )}

            <form onSubmit={handleSubmitProof} className="space-y-4">
              {/* Payment Method Dropdown */}
              <div>
                <label
                  htmlFor="proof-method"
                  className="block text-xs font-semibold text-slate-300 mb-1.5"
                >
                  Payment Channel Used
                </label>
                <select
                  id="proof-method"
                  value={selectedMethod}
                  onChange={(e) =>
                    setSelectedMethod(e.target.value as PaymentMethodCode)
                  }
                  disabled={submitting || isBlocked}
                  className="w-full h-10 px-3 rounded-xl bg-[#141722] border border-[#2e3446] text-xs font-bold text-white focus:border-[#22ab68] focus:outline-none"
                >
                  <option value="ESEWA">
                    eSewa Wallet
                    {!paymentDetails.hideDepositDetails &&
                    !paymentDetails.methods.ESEWA.hideDetails
                      ? ` (${paymentDetails.methods.ESEWA.accountIdentifier})`
                      : ''}
                  </option>
                  <option value="KHALTI">
                    Khalti Digital Wallet
                    {!paymentDetails.hideDepositDetails &&
                    !paymentDetails.methods.KHALTI.hideDetails
                      ? ` (${paymentDetails.methods.KHALTI.accountIdentifier})`
                      : ''}
                  </option>
                  <option value="BANK_TRANSFER">
                    Bank Transfer / ConnectIPS
                    {!paymentDetails.hideDepositDetails &&
                    !paymentDetails.methods.BANK_TRANSFER.hideDetails
                      ? ` (${paymentDetails.methods.BANK_TRANSFER.accountIdentifier})`
                      : ''}
                  </option>
                </select>
              </div>

              {/* Deposit Amount Input + NPR/USDT Live Conversion */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label
                    htmlFor="proof-amount"
                    className="text-xs font-semibold text-slate-300"
                  >
                    Amount Sent ({currency})
                  </label>
                  <span className="text-[11px] font-mono text-[#8c94ab] tabular-nums">
                    {depositLimits.minDisplayFormatted} –{' '}
                    {depositLimits.maxDisplayFormatted}
                  </span>
                </div>
                <input
                  id="proof-amount"
                  type="number"
                  step="0.01"
                  min={depositLimits.minDisplay}
                  max={depositLimits.maxDisplay}
                  required
                  disabled={submitting || isBlocked}
                  value={depositAmount}
                  onChange={(e) => setDepositAmount(e.target.value)}
                  className="w-full h-11 px-3.5 rounded-xl bg-[#141722] border border-[#2e3446] focus:border-[#22ab68] focus:outline-none text-sm font-mono font-bold text-white tabular-nums"
                />

                {/* Dual Currency Equivalent Bar */}
                <div className="mt-1.5 px-3 py-2 rounded-lg bg-[#141722] border border-[#262b38] flex items-center justify-between text-[11px] font-mono tabular-nums">
                  <span className="text-[#8c94ab]">
                    {currency === 'NPR'
                      ? 'Credited Base USDT:'
                      : 'Exact NPR to Transfer:'}
                  </span>
                  <span className="font-bold text-[#22ab68]">
                    {currency === 'NPR'
                      ? `$${depositConversion.baseUsdtString} USDT`
                      : `Rs ${equivalentNpr.toLocaleString('en-US', {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })} NPR`}
                  </span>
                </div>

                {/* Preset Quick Amounts */}
                <div className="grid grid-cols-4 gap-2 mt-2">
                  {depositLimits.quickAmountsDisplay.map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      disabled={submitting || isBlocked}
                      onClick={() => setDepositAmount(String(preset))}
                      className="h-8 rounded-lg bg-[#252a3a] hover:bg-[#2f364a] text-[11px] font-mono font-bold text-slate-200 transition-colors cursor-pointer truncate px-1"
                    >
                      +
                      {currency === 'NPR'
                        ? `Rs ${preset.toLocaleString('en-US')}`
                        : `$${preset.toLocaleString('en-US')}`}
                    </button>
                  ))}
                </div>
              </div>

              {/* Payment Proof Screenshot Upload (Max 2 MB) */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label
                    htmlFor="manual-proof-upload"
                    className="flex items-center gap-1.5 text-xs font-semibold text-slate-300"
                  >
                    <ImageIcon className="w-3.5 h-3.5 text-[#22ab68]" />
                    <span>
                      Payment Proof Screenshot <span className="text-[#e34c3b]">*</span>
                    </span>
                  </label>
                  <span className="text-[11px] font-mono text-[#8c94ab]">
                    Max Size: 2 MB
                  </span>
                </div>

                <input
                  ref={proofFileInputRef}
                  id="manual-proof-upload"
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  disabled={submitting || isBlocked}
                  onChange={(e) => {
                    const file = e.target.files?.[0] || null;
                    setErrorMsg(null);
                    if (!file) {
                      setProofFile(null);
                      setProofPreview(null);
                      return;
                    }
                    const err = validatePaymentProofFile(file);
                    if (err) {
                      setProofFile(null);
                      setProofPreview(null);
                      e.target.value = '';
                      setErrorMsg(err);
                      setToast({ type: 'error', message: err });
                      return;
                    }
                    setProofFile(file);
                    const reader = new FileReader();
                    reader.onload = () => {
                      setProofPreview(
                        typeof reader.result === 'string' ? reader.result : null
                      );
                    };
                    reader.readAsDataURL(file);
                  }}
                  className="hidden"
                />

                {!proofFile ? (
                  <button
                    type="button"
                    disabled={submitting || isBlocked}
                    onClick={() => proofFileInputRef.current?.click()}
                    className="w-full p-5 rounded-xl bg-[#141722] hover:bg-[#181d2b] border border-dashed border-[#343b4f] hover:border-[#22ab68] transition-colors flex flex-col items-center justify-center gap-1.5 text-xs text-slate-300 cursor-pointer disabled:opacity-50"
                  >
                    <Upload className="w-5 h-5 text-[#22ab68]" />
                    <span className="font-bold text-white">
                      Click to upload payment proof screenshot
                    </span>
                    <span className="text-[11px] text-[#8c94ab]">
                      PNG, JPG, WEBP or GIF · Maximum file size 2 MB
                    </span>
                  </button>
                ) : (
                  <div className="p-3 rounded-xl bg-[#141722] border border-[#22ab68]/40 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      {proofPreview && (
                        /* eslint-disable-next-line @next/next/no-img-element */
                        <img
                          src={proofPreview}
                          alt="Payment proof preview"
                          className="w-12 h-12 rounded-md object-cover border border-[#2e3446] shrink-0"
                        />
                      )}
                      <div className="min-w-0">
                        <div className="text-xs font-bold text-white truncate">
                          {proofFile.name}
                        </div>
                        <div className="text-[11px] font-mono text-[#22ab68]">
                          {(proofFile.size / 1024).toFixed(1)} KB / 2048 KB Max
                        </div>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setProofFile(null);
                        setProofPreview(null);
                        if (proofFileInputRef.current) {
                          proofFileInputRef.current.value = '';
                        }
                      }}
                      className="p-2 rounded-lg bg-[#252a3a] hover:bg-[#e34c3b]/20 text-slate-300 hover:text-rose-300 transition-colors cursor-pointer shrink-0"
                      title="Remove screenshot"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                )}
              </div>

              <button
                type="submit"
                disabled={
                  submitting ||
                  !proofFile ||
                  isBlocked ||
                  pendingRequestsCount >= 3
                }
                className="w-full min-h-[44px] py-2.5 px-4 rounded-xl bg-[#22ab68] hover:bg-[#1e995d] disabled:opacity-50 text-xs font-bold text-white flex items-center justify-center gap-2 transition-colors cursor-pointer"
              >
                <Send className="w-4 h-4" />
                <span>
                  {submitting
                    ? 'Uploading Screenshot & Submitting...'
                    : `Submit ${getMethodLabel(selectedMethod)} Payment Proof`}
                </span>
              </button>
            </form>
          </section>
        </div>

        {/* User's Recent Manual Deposit Requests Table */}
        <section className="bg-[#1c202b] border border-[#2e3446] rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-[#262b38] flex items-center justify-between">
            <div className="flex items-center gap-2">
              <FileText className="w-4 h-4 text-[#3898ff]" />
              <h2 className="text-sm font-bold text-white">
                Your Recent Manual Deposit Submissions
              </h2>
            </div>
            <span className="text-xs font-mono text-[#8c94ab]">
              Showing latest {requests.length} deposit(s)
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-[#262b38] bg-[#141722] text-[11px] font-mono uppercase text-[#8c94ab]">
                  <th className="py-3 px-4">Submitted</th>
                  <th className="py-3 px-4">Method</th>
                  <th className="py-3 px-4 text-right">Amount</th>
                  <th className="py-3 px-4">Payment Proof Screenshot</th>
                  <th className="py-3 px-4 text-right">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#262b38]">
                {loading ? (
                  <tr>
                    <td
                      colSpan={5}
                      className="py-8 text-center text-[#8c94ab]"
                    >
                      Loading your deposit submissions...
                    </td>
                  </tr>
                ) : requests.length === 0 ? (
                  <tr>
                    <td
                      colSpan={5}
                      className="py-8 text-center text-[#8c94ab]"
                    >
                      No manual deposit submissions yet. Complete Step 1 and Step
                      2 above to submit your first deposit proof.
                    </td>
                  </tr>
                ) : (
                  requests.map((req) => {
                    const parsed = parsePaymentProofFromNote(req.note);
                    return (
                      <tr key={req.id} className="hover:bg-[#232837]/40">
                        <td className="py-3 px-4 font-mono text-[11px] text-slate-300 tabular-nums whitespace-nowrap">
                          {new Date(req.created_at).toLocaleString()}
                        </td>
                        <td className="py-3 px-4 font-semibold text-white whitespace-nowrap">
                          {parsed.methodLabel || 'Manual Deposit'}
                        </td>
                        <td className="py-3 px-4 text-right font-mono font-bold text-white tabular-nums whitespace-nowrap">
                          {formatMoney(req.amount)}
                        </td>
                        <td className="py-3 px-4 text-slate-300 max-w-xs">
                          <div className="flex items-center gap-2">
                            {parsed.screenshotUrl ? (
                              <a
                                href={parsed.screenshotUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-2 text-[#3898ff] hover:underline font-semibold shrink-0"
                              >
                                <img
                                  src={parsed.screenshotUrl}
                                  alt="Payment Proof"
                                  className="w-8 h-8 rounded object-cover border border-[#2e3446] bg-[#141722]"
                                />
                                <span>View Screenshot</span>
                                <ExternalLink className="w-3 h-3" />
                              </a>
                            ) : (
                              <span className="text-[#7c849b]">—</span>
                            )}
                          </div>
                          {req.admin_note && (
                            <div className="text-[11px] text-indigo-300 mt-1">
                              Admin: {req.admin_note}
                            </div>
                          )}
                        </td>
                        <td className="py-3 px-4 text-right whitespace-nowrap">
                          <span
                            className={`font-mono font-bold text-[11px] ${
                              req.status === 'APPROVED'
                                ? 'text-[#22ab68]'
                                : req.status === 'REJECTED'
                                  ? 'text-[#e34c3b]'
                                  : 'text-[#f59e0b]'
                            }`}
                          >
                            {req.status === 'PENDING' && (
                              <Clock className="w-3 h-3 inline mr-1 -mt-0.5" />
                            )}
                            {req.status}
                          </span>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <ToastBanner toast={toast} onDismiss={() => setToast(null)} />
    </div>
  );
}
