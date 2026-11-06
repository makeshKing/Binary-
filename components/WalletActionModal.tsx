'use client';

import React, { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import {
  X,
  ArrowDownLeft,
  ArrowUpRight,
  CheckCircle2,
  AlertCircle,
  Copy,
  Check,
  Wallet,
  Lock,
  Landmark,
  Smartphone,
  QrCode,
  ExternalLink,
  Image as ImageIcon,
  Upload,
  Trash2,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import {
  isSupabaseConfigured,
  UserStatus,
  WalletRequestRow,
  resolveUserNumber,
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
  DEFAULT_MANUAL_PAYMENT_DETAILS,
  ManualPaymentDetailsState,
  PaymentMethodCode,
  buildPaymentProofNote,
  buildWithdrawalPayoutNote,
  getMethodLabel,
  uploadPaymentProofScreenshot,
  validatePaymentProofFile,
} from '@/lib/payment-details';

export interface WalletActionModalProps {
  isOpen: boolean;
  initialMode: 'DEPOSIT' | 'WITHDRAW';
  onClose: () => void;
  userId: string | null;
  userNumber: number | null;
  userStatus?: UserStatus;
  balance: number;
  pendingWithdrawalsTotal: number;
  pendingRequestsCount: number;
  onRequestCreated?: (req: WalletRequestRow) => void;
  onToast?: (toast: {
    type: 'success' | 'error' | 'info';
    message: string;
  }) => void;
}

interface SupabaseErrorDetails {
  message: string;
  code?: string;
  details?: string | null;
  hint?: string | null;
}

function formatSupabaseError(
  err: SupabaseErrorDetails,
  fallbackLabel: string
): string {
  const parts: string[] = [err.message || fallbackLabel];
  if (err.code) parts.push(`[Code: ${err.code}]`);
  if (err.details) parts.push(`Details: ${err.details}`);
  if (err.hint) parts.push(`Hint: ${err.hint}`);
  return parts.join(' ');
}

const DEPOSIT_PRESETS_USDT = [100, 500, 1000, 5000] as const;
const WITHDRAW_PRESETS_USDT = [50, 250, 500, 1000] as const;

export function WalletActionModal({
  isOpen,
  initialMode,
  onClose,
  userId,
  userNumber,
  userStatus = 'ACTIVE',
  balance,
  pendingWithdrawalsTotal,
  pendingRequestsCount,
  onRequestCreated,
  onToast,
}: WalletActionModalProps) {
  const configured = isSupabaseConfigured();
  const { currency, rate, isFading, formatMoney, toBase } = useCurrency();
  const [mode, setMode] = useState<'DEPOSIT' | 'WITHDRAW'>(initialMode);
  const [amount, setAmount] = useState<string>(
    initialMode === 'DEPOSIT' ? '500' : '250'
  );
  const [note, setNote] = useState<string>('');
  const [paymentDetails, setPaymentDetails] =
    useState<ManualPaymentDetailsState>(DEFAULT_MANUAL_PAYMENT_DETAILS);
  const [selectedMethod, setSelectedMethod] =
    useState<PaymentMethodCode>('ESEWA');
  const [depositProofFile, setDepositProofFile] = useState<File | null>(null);
  const [depositProofPreview, setDepositProofPreview] = useState<string | null>(
    null
  );
  const depositFileInputRef = useRef<HTMLInputElement | null>(null);
  const [withdrawMethod, setWithdrawMethod] =
    useState<PaymentMethodCode>('ESEWA');
  const [withdrawAccountId, setWithdrawAccountId] = useState<string>('');
  const [withdrawAccountName, setWithdrawAccountName] = useState<string>('');
  const [withdrawBankName, setWithdrawBankName] = useState<string>('');
  const [withdrawBranchName, setWithdrawBranchName] = useState<string>('');
  const [copiedAccountField, setCopiedAccountField] = useState<string | null>(
    null
  );
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [errorDetailsObj, setErrorDetailsObj] =
    useState<SupabaseErrorDetails | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<boolean>(false);

  const prevCurrencyRef = useRef<CurrencyCode>(currency);
  const lastBaseUsdtRef = useRef<number>(initialMode === 'DEPOSIT' ? 500 : 250);

  const conversion = toBase(amount);
  const baseUsdtAmount = conversion.baseUsdt;

  useEffect(() => {
    if (Number.isFinite(baseUsdtAmount) && baseUsdtAmount > 0) {
      lastBaseUsdtRef.current = baseUsdtAmount;
    }
  }, [baseUsdtAmount]);

  useEffect(() => {
    if (!isOpen) return;
    let active = true;
    fetch('/api/payment-details', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => {
        if (!active || !json?.paymentDetails) return;
        const loaded = json.paymentDetails as ManualPaymentDetailsState;
        setPaymentDetails(loaded);
        if (!loaded.methods[selectedMethod]?.enabled) {
          const firstEnabled = (
            ['ESEWA', 'KHALTI', 'BANK_TRANSFER'] as PaymentMethodCode[]
          ).find((c) => loaded.methods[c]?.enabled);
          if (firstEnabled) setSelectedMethod(firstEnabled);
        }
      })
      .catch(() => {
        // Fallback to default payment details
      });
    return () => {
      active = false;
    };
  }, [isOpen, selectedMethod]);

  useEffect(() => {
    if (isOpen) {
      setMode(initialMode);
      const defaultBase = initialMode === 'DEPOSIT' ? 500 : 250;
      lastBaseUsdtRef.current = defaultBase;
      const initialStr = fromBaseToInputString(defaultBase, currency, rate);
      setAmount(
        initialStr.endsWith('.00') ? initialStr.slice(0, -3) : initialStr
      );
      setNote('');
      setDepositProofFile(null);
      setDepositProofPreview(null);
      if (depositFileInputRef.current) {
        depositFileInputRef.current.value = '';
      }
      setErrorMsg(null);
      setErrorDetailsObj(null);
      setSuccessMsg(null);
      prevCurrencyRef.current = currency;
    }
  }, [isOpen, initialMode, currency, rate]);

  useEffect(() => {
    if (isOpen && prevCurrencyRef.current !== currency) {
      const convertedStr = fromBaseToInputString(
        lastBaseUsdtRef.current || 100,
        currency,
        rate
      );
      setAmount(
        convertedStr.endsWith('.00') ? convertedStr.slice(0, -3) : convertedStr
      );
      prevCurrencyRef.current = currency;
    }
  }, [isOpen, currency, rate]);

  if (!isOpen) return null;

  const displayUserNumber = resolveUserNumber(userNumber, userId);
  const availableBalance = Math.max(
    0,
    Number((balance - pendingWithdrawalsTotal).toFixed(2))
  );
  const isBlocked =
    userStatus === 'SUSPENDED' || userStatus === 'DISABLED';

  const limits = getLimitsInCurrency(
    10,
    10000,
    mode === 'DEPOSIT' ? DEPOSIT_PRESETS_USDT : WITHDRAW_PRESETS_USDT,
    currency,
    rate
  );

  const activeMethodConfig =
    paymentDetails.methods[selectedMethod] ||
    paymentDetails.methods.ESEWA;

  const handleCopyUserId = async () => {
    if (!displayUserNumber) return;
    try {
      await navigator.clipboard.writeText(String(displayUserNumber));
      setCopiedId(true);
      onToast?.({
        type: 'success',
        message: 'Copied',
      });
      setTimeout(() => setCopiedId(false), 2000);
    } catch {
      // Ignore clipboard permission failure
    }
  };

  const handleCopyPaymentField = async (label: string, value: string) => {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopiedAccountField(label);
      onToast?.({
        type: 'success',
        message: `${label} copied`,
      });
      setTimeout(() => setCopiedAccountField(null), 1800);
    } catch {
      // Ignore clipboard failure
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setErrorDetailsObj(null);
    setSuccessMsg(null);

    if (isBlocked) {
      const msg = `Your account status is ${userStatus}. Only ACTIVE accounts can submit deposit or withdrawal requests.`;
      setErrorMsg(msg);
      onToast?.({ type: 'error', message: msg });
      return;
    }

    const rawInputNum = Number(amount);
    if (
      !Number.isFinite(rawInputNum) ||
      !/^\d+(\.\d{1,2})?$/.test(amount.trim())
    ) {
      const msg = 'Amount can have at most 2 decimal places.';
      setErrorMsg(msg);
      onToast?.({ type: 'error', message: msg });
      return;
    }

    if (baseUsdtAmount < 10 || baseUsdtAmount > 10000) {
      const msg = `${
        mode === 'DEPOSIT' ? 'Deposit' : 'Withdrawal'
      } amount must be between ${limits.minDisplayFormatted} and ${
        limits.maxDisplayFormatted
      } ($10.00 – $10,000.00 USDT).`;
      setErrorMsg(msg);
      onToast?.({ type: 'error', message: msg });
      return;
    }

    if (mode === 'DEPOSIT') {
      const proofError = validatePaymentProofFile(depositProofFile);
      if (proofError || !depositProofFile) {
        const msg =
          proofError ||
          'Please upload a payment proof screenshot image (Max 2 MB).';
        setErrorMsg(msg);
        onToast?.({ type: 'error', message: msg });
        return;
      }
    }

    if (pendingRequestsCount >= 3) {
      const msg =
        'You already have 3 pending requests (maximum allowed). Please wait for admin review.';
      setErrorMsg(msg);
      onToast?.({ type: 'error', message: msg });
      return;
    }

    if (mode === 'WITHDRAW' && baseUsdtAmount > availableBalance) {
      const msg = `Insufficient available balance (${formatMoney(
        availableBalance
      )} available after ${formatMoney(
        pendingWithdrawalsTotal
      )} in pending withdrawals).`;
      setErrorMsg(msg);
      onToast?.({ type: 'error', message: msg });
      return;
    }

    if (mode === 'WITHDRAW') {
      if (withdrawMethod === 'BANK_TRANSFER' && !withdrawBankName.trim()) {
        const msg = 'Please enter your Bank Name for the bank transfer withdrawal.';
        setErrorMsg(msg);
        onToast?.({ type: 'error', message: msg });
        return;
      }
      if (!withdrawAccountId.trim()) {
        const msg =
          withdrawMethod === 'BANK_TRANSFER'
            ? 'Please enter your Bank Account Number.'
            : `Please enter your ${getMethodLabel(withdrawMethod)} ID / Mobile Number.`;
        setErrorMsg(msg);
        onToast?.({ type: 'error', message: msg });
        return;
      }
      if (!withdrawAccountName.trim()) {
        const msg = `Please enter the ${
          withdrawMethod === 'BANK_TRANSFER'
            ? 'Bank Account Holder Name'
            : `${getMethodLabel(withdrawMethod)} Account Holder Name`
        }.`;
        setErrorMsg(msg);
        onToast?.({ type: 'error', message: msg });
        return;
      }
    }

    if (!configured) {
      const msg =
        'Supabase environment variables are not configured. Cannot submit wallet request.';
      setErrorMsg(msg);
      onToast?.({ type: 'error', message: msg });
      return;
    }

    const currencyNoteSuffix =
      currency === 'NPR' && rate
        ? `[Entered as ${conversion.exactDisplayFormatted} @ ${rate.toFixed(
            2
          )} = $${baseUsdtAmount.toFixed(2)} USDT]`
        : '';

    setSubmitting(true);
    try {
      let cleanNote = '';
      if (mode === 'DEPOSIT') {
        const uploadedProofUrl = await uploadPaymentProofScreenshot(
          depositProofFile!,
          depositProofPreview
        );
        cleanNote = buildPaymentProofNote({
          userNumber: displayUserNumber || '—',
          methodCode: selectedMethod,
          screenshotUrl: uploadedProofUrl,
          currencySuffix: currencyNoteSuffix,
        });
      } else {
        cleanNote = buildWithdrawalPayoutNote({
          userNumber: displayUserNumber || '—',
          methodCode: withdrawMethod,
          accountName: withdrawAccountName.trim(),
          accountIdentifier: withdrawAccountId.trim(),
          bankName: withdrawBankName.trim(),
          branchName: withdrawBranchName.trim(),
          userNote: note.trim(),
          currencySuffix: currencyNoteSuffix,
        });
      }
      const supabase = createClient();

      const {
        data: { session },
      } = await supabase.auth.getSession();
      let activeUser = session?.user ?? null;

      if (!activeUser) {
        const {
          data: { user },
          error: authError,
        } = await supabase.auth.getUser();
        if (authError) {
          console.warn('[WalletActionModal] Auth check warning:', {
            message: authError.message,
            code: authError.code,
            status: authError.status,
          });
        }
        activeUser = user;
      }

      if (!activeUser || !isRealAuthenticatedUser(activeUser)) {
        const authErrObj: SupabaseErrorDetails = {
          message:
            'Authentication required: You are not signed in. Please log in to submit a wallet request.',
          code: 'AUTH_SESSION_MISSING',
          details: 'No valid authenticated user session found.',
          hint: 'Sign in at /login and try again.',
        };
        const formatted = formatSupabaseError(
          authErrObj,
          'Authentication required.'
        );
        setErrorDetailsObj(authErrObj);
        setErrorMsg(formatted);
        onToast?.({ type: 'error', message: formatted });
        return;
      }

      const rpcName =
        mode === 'DEPOSIT' ? 'request_deposit' : 'request_withdraw';
      const rpcParams = {
        p_amount: Number(baseUsdtAmount.toFixed(2)),
        p_note: cleanNote,
      };

      const { data, error } = await supabase.rpc(rpcName, rpcParams);

      if (error) {
        const errPayload: SupabaseErrorDetails = {
          message: error.message,
          code: error.code,
          details: error.details,
          hint: error.hint,
        };
        console.warn(`[WalletActionModal] RPC ${rpcName} failed:`, errPayload);
        const formatted = formatSupabaseError(
          errPayload,
          `Failed to submit ${mode.toLowerCase()} request.`
        );
        setErrorDetailsObj(errPayload);
        setErrorMsg(formatted);
        onToast?.({
          type: 'error',
          message: formatted,
        });
      } else {
        const created = data as WalletRequestRow | null;
        if (created) {
          onRequestCreated?.({
            ...created,
            user_number:
              created.user_number ??
              resolveUserNumber(userNumber, activeUser.id),
          });
        }
        setNote('');
        setDepositProofFile(null);
        setDepositProofPreview(null);
        if (depositFileInputRef.current) {
          depositFileInputRef.current.value = '';
        }
        setWithdrawAccountId('');
        setWithdrawAccountName('');
        setWithdrawBankName('');
        setWithdrawBranchName('');
        setSuccessMsg('Your request was sent for admin approval');
        onToast?.({
          type: 'success',
          message: 'Your request was sent for admin approval',
        });
      }
    } catch (err) {
      const unknownMessage =
        err instanceof Error
          ? err.message
          : 'Unexpected network error while submitting request.';
      console.warn('[WalletActionModal] Exception during RPC call:', err);
      setErrorMsg(unknownMessage);
      onToast?.({
        type: 'error',
        message: unknownMessage,
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[90] bg-black/75 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="wallet-modal-title"
    >
      <div className="w-full max-w-lg bg-[#1c202e] border border-[#2e3446] rounded-2xl shadow-2xl overflow-hidden text-slate-100 my-auto max-h-[92vh] flex flex-col">
        {/* Top Modal Header */}
        <div className="px-5 py-3.5 bg-[#171a24] border-b border-[#262b38] flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            {mode === 'DEPOSIT' ? (
              <div className="w-8 h-8 rounded-lg bg-[#22ab68]/15 border border-[#22ab68]/40 flex items-center justify-center text-[#22ab68]">
                <ArrowDownLeft className="w-4 h-4" />
              </div>
            ) : (
              <div className="w-8 h-8 rounded-lg bg-[#e34c3b]/15 border border-[#e34c3b]/40 flex items-center justify-center text-[#e34c3b]">
                <ArrowUpRight className="w-4 h-4" />
              </div>
            )}
            <div>
              <h2 id="wallet-modal-title" className="text-sm font-bold text-white">
                {mode === 'DEPOSIT'
                  ? 'Manual Deposit & Payment Proof'
                  : 'Request Withdrawal'}
              </h2>
              <p className="text-[11px] text-[#8c94ab]">
                Live Account · User ID: {displayUserNumber || '—'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <CurrencyToggleButton />
            <button
              type="button"
              onClick={onClose}
              className="w-8 h-8 rounded-lg bg-[#252a3a] hover:bg-[#31384d] text-slate-300 hover:text-white flex items-center justify-center cursor-pointer"
              aria-label="Close modal"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Mode Switcher Tabs */}
        <div className="grid grid-cols-2 bg-[#141722] border-b border-[#262b38] shrink-0">
          <button
            type="button"
            onClick={() => {
              setMode('DEPOSIT');
              setErrorMsg(null);
              setErrorDetailsObj(null);
              setSuccessMsg(null);
            }}
            className={`h-10 text-xs font-bold flex items-center justify-center gap-1.5 transition-colors cursor-pointer ${
              mode === 'DEPOSIT'
                ? 'bg-[#1c202e] text-[#22ab68] border-b-2 border-b-[#22ab68]'
                : 'text-[#7c849b] hover:text-slate-200'
            }`}
          >
            <ArrowDownLeft className="w-3.5 h-3.5" />
            <span>Deposit</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setMode('WITHDRAW');
              setErrorMsg(null);
              setErrorDetailsObj(null);
              setSuccessMsg(null);
            }}
            className={`h-10 text-xs font-bold flex items-center justify-center gap-1.5 transition-colors cursor-pointer ${
              mode === 'WITHDRAW'
                ? 'bg-[#1c202e] text-[#e34c3b] border-b-2 border-b-[#e34c3b]'
                : 'text-[#7c849b] hover:text-slate-200'
            }`}
          >
            <ArrowUpRight className="w-3.5 h-3.5" />
            <span>Withdrawal</span>
          </button>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto flex-1">
          {/* 5-Digit User ID Reference Bar */}
          <div className="px-3.5 py-2.5 rounded-xl bg-[#141722] border border-[#2a3146] flex items-center justify-between gap-2 text-xs">
            <span className="text-slate-200 font-semibold">
              Account Reference ID (Include in Payment Remarks)
            </span>
            {displayUserNumber > 0 && (
              <button
                type="button"
                onClick={handleCopyUserId}
                className="px-2 py-1 rounded bg-[#252a3a] hover:bg-[#2f364a] text-[11px] font-mono font-bold text-[#3898ff] flex items-center gap-1 cursor-pointer"
                title="Copy 5-digit User ID"
              >
                <span>User ID: {displayUserNumber}</span>
                {copiedId ? (
                  <Check className="w-3 h-3 text-[#22ab68]" />
                ) : (
                  <Copy className="w-3 h-3" />
                )}
              </button>
            )}
          </div>

          {/* Balance & Available Summary */}
          <div className="grid grid-cols-2 gap-3 bg-[#141722] border border-[#262b38] rounded-xl p-3 text-xs">
            <div>
              <div className="text-[#8c94ab]">Current Balance</div>
              <div
                className={`font-mono font-bold text-white text-sm mt-0.5 tabular-nums transition-opacity duration-150 ${
                  isFading ? 'opacity-30' : 'opacity-100'
                }`}
              >
                {formatMoney(balance)}
              </div>
            </div>
            <div>
              <div className="text-[#8c94ab]">Available to Withdraw</div>
              <div
                className={`font-mono font-bold text-[#22ab68] text-sm mt-0.5 tabular-nums transition-opacity duration-150 ${
                  isFading ? 'opacity-30' : 'opacity-100'
                }`}
              >
                {formatMoney(availableBalance)}
              </div>
              {pendingWithdrawalsTotal > 0 && (
                <div className="text-[10px] font-mono text-[#f59e0b]">
                  -{formatMoney(pendingWithdrawalsTotal)} pending
                </div>
              )}
            </div>
          </div>

          {/* Nepal Local Manual Payment Details Section (when DEPOSIT is active) */}
          {mode === 'DEPOSIT' && (
            <div className="rounded-xl bg-[#141722] border border-[#2a3146] p-3.5 space-y-3">
              {/* Custom Admin Deposit Message Banner (when details are hidden OR banner is enabled) */}
              {(paymentDetails.hideDepositDetails ||
                (paymentDetails.showDepositMessageBanner &&
                  paymentDetails.depositMessage?.trim())) && (
                <div className="rounded-xl bg-amber-500/10 border border-amber-500/35 p-3.5 space-y-1.5 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-bold text-amber-300 flex items-center gap-1.5">
                      <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
                      <span>
                        {paymentDetails.hideDepositDetails
                          ? 'Deposit Notice from Administrator'
                          : 'Important Deposit Message'}
                      </span>
                    </span>
                    <span className="text-[10px] font-mono text-amber-200/80">
                      {paymentDetails.supportContact}
                    </span>
                  </div>
                  <p className="text-slate-100 leading-relaxed whitespace-pre-line">
                    {paymentDetails.depositMessage?.trim() ||
                      'Manual deposit account details are temporarily hidden by the administrator. Please contact support or check back shortly for updated deposit instructions.'}
                  </p>
                </div>
              )}

              {!paymentDetails.hideDepositDetails && (
                <>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-bold text-white">
                      1. Select Nepal Payment Method
                    </span>
                    <Link
                      href={`/wallet/payment-details?method=${selectedMethod}`}
                      prefetch={false}
                      onClick={onClose}
                      className="text-[11px] font-bold text-[#3898ff] hover:underline inline-flex items-center gap-1"
                    >
                      <QrCode className="w-3 h-3" />
                      <span>Full Payment Details &amp; QR Page</span>
                      <ExternalLink className="w-3 h-3" />
                    </Link>
                  </div>

                  <div className="grid grid-cols-3 gap-2">
                    {(
                      ['ESEWA', 'KHALTI', 'BANK_TRANSFER'] as PaymentMethodCode[]
                    ).map((code) => {
                      const m = paymentDetails.methods[code];
                      const isSelected = selectedMethod === code;
                      return (
                        <button
                          key={code}
                          type="button"
                          onClick={() => setSelectedMethod(code)}
                          className={`p-2 rounded-lg border text-left transition-colors cursor-pointer ${
                            isSelected
                              ? code === 'ESEWA'
                                ? 'bg-[#22ab68]/15 border-[#22ab68] text-white'
                                : code === 'KHALTI'
                                  ? 'bg-purple-500/15 border-purple-400 text-white'
                                  : 'bg-[#3898ff]/15 border-[#3898ff] text-white'
                              : 'bg-[#1c202e] border-[#2e3446] text-[#8c94ab] hover:text-white'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-1">
                            <span className="text-xs font-bold">
                              {getMethodLabel(code)}
                            </span>
                            {code === 'BANK_TRANSFER' ? (
                              <Landmark className="w-3.5 h-3.5 shrink-0" />
                            ) : (
                              <Smartphone className="w-3.5 h-3.5 shrink-0" />
                            )}
                          </div>
                          <div className="text-[10px] text-[#8c94ab] truncate mt-0.5">
                            {m?.hideDetails
                              ? 'Notice'
                              : m?.enabled
                                ? m.processingTime
                                : 'Disabled'}
                          </div>
                        </button>
                      );
                    })}
                  </div>

                  {activeMethodConfig &&
                    (activeMethodConfig.hideDetails ? (
                      <div className="rounded-lg bg-amber-500/10 border border-amber-500/35 p-3 space-y-1.5 text-xs">
                        <div className="font-bold text-amber-300 flex items-center gap-1.5">
                          <AlertCircle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                          <span>
                            {getMethodLabel(selectedMethod)} Deposit Notice
                          </span>
                        </div>
                        <p className="text-slate-200 leading-relaxed whitespace-pre-line">
                          {activeMethodConfig.customMessage?.trim() ||
                            paymentDetails.depositMessage?.trim() ||
                            'Account details for this payment channel are currently hidden by the administrator.'}
                        </p>
                      </div>
                    ) : (
                      <div className="rounded-lg bg-[#1c202e] border border-[#2a3146] p-3 space-y-2 text-xs">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[#8c94ab]">Account Name:</span>
                          <div className="flex items-center gap-1.5">
                            <span className="font-semibold text-white">
                              {activeMethodConfig.accountName}
                            </span>
                            <button
                              type="button"
                              onClick={() =>
                                handleCopyPaymentField(
                                  'Account Name',
                                  activeMethodConfig.accountName
                                )
                              }
                              className="p-1 rounded bg-[#252a3a] hover:bg-[#31384d] text-[#8c94ab] hover:text-white cursor-pointer"
                              title="Copy Account Name"
                            >
                              {copiedAccountField === 'Account Name' ? (
                                <Check className="w-3 h-3 text-[#22ab68]" />
                              ) : (
                                <Copy className="w-3 h-3" />
                              )}
                            </button>
                          </div>
                        </div>

                        {selectedMethod === 'BANK_TRANSFER' &&
                          activeMethodConfig.bankName && (
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-[#8c94ab]">
                                Bank / Branch:
                              </span>
                              <span className="font-semibold text-slate-200 text-right">
                                {activeMethodConfig.bankName}
                                {activeMethodConfig.branchName
                                  ? ` (${activeMethodConfig.branchName})`
                                  : ''}
                              </span>
                            </div>
                          )}

                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[#8c94ab]">
                            {selectedMethod === 'BANK_TRANSFER'
                              ? 'Account Number:'
                              : `${getMethodLabel(selectedMethod)} ID:`}
                          </span>
                          <div className="flex items-center gap-1.5">
                            <span className="font-mono font-bold text-[#22ab68] text-sm tabular-nums">
                              {activeMethodConfig.accountIdentifier}
                            </span>
                            <button
                              type="button"
                              onClick={() =>
                                handleCopyPaymentField(
                                  'Account ID',
                                  activeMethodConfig.accountIdentifier
                                )
                              }
                              className="px-2 py-0.5 rounded bg-[#252a3a] hover:bg-[#31384d] text-[11px] font-bold text-slate-200 flex items-center gap-1 cursor-pointer"
                            >
                              {copiedAccountField === 'Account ID' ? (
                                <>
                                  <Check className="w-3 h-3 text-[#22ab68]" />
                                  <span className="text-[#22ab68]">Copied</span>
                                </>
                              ) : (
                                <>
                                  <Copy className="w-3 h-3 text-[#8c94ab]" />
                                  <span>Copy</span>
                                </>
                              )}
                            </button>
                          </div>
                        </div>

                        <p className="text-[11px] text-[#9aa3ba] leading-relaxed pt-1 border-t border-[#262b38]">
                          {activeMethodConfig.instructions}
                        </p>
                      </div>
                    ))}
                </>
              )}
            </div>
          )}

          {isBlocked && (
            <div className="p-3 rounded-xl bg-[#e34c3b]/15 border border-[#e34c3b]/40 text-xs text-red-200 flex items-start gap-2">
              <Lock className="w-4 h-4 text-[#e34c3b] shrink-0 mt-0.5" />
              <span>
                Your account is currently <strong>{userStatus}</strong>.
                Suspended or disabled accounts cannot create deposit or
                withdrawal requests.
              </span>
            </div>
          )}

          {errorMsg && (
            <div className="p-3 rounded-xl bg-[#e34c3b]/15 border border-[#e34c3b]/40 text-xs text-red-200 space-y-1.5">
              <div className="flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-[#e34c3b] shrink-0 mt-0.5" />
                <span className="font-semibold">{errorMsg}</span>
              </div>
              {errorDetailsObj && (
                <div className="pl-6 text-[11px] font-mono text-red-300/90 space-y-0.5 break-all">
                  {errorDetailsObj.code && (
                    <div>code: {errorDetailsObj.code}</div>
                  )}
                  {errorDetailsObj.details && (
                    <div>details: {errorDetailsObj.details}</div>
                  )}
                  {errorDetailsObj.hint && (
                    <div>hint: {errorDetailsObj.hint}</div>
                  )}
                </div>
              )}
            </div>
          )}

          {successMsg && (
            <div className="p-3.5 rounded-xl bg-[#22ab68]/15 border border-[#22ab68]/40 text-xs text-emerald-100 flex items-start gap-2.5">
              <CheckCircle2 className="w-4 h-4 text-[#22ab68] shrink-0 mt-0.5" />
              <div className="space-y-1">
                <div className="font-bold text-white">{successMsg}</div>
                <div className="text-[11px] text-emerald-200/90">
                  Support Reference — User ID:{' '}
                  <span className="font-mono font-bold">
                    {displayUserNumber || '—'}
                  </span>
                  . Your account balance will update automatically once an
                  administrator approves the request.
                </div>
              </div>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-3.5">
            {mode === 'WITHDRAW' && (
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                    1. Select Withdrawal Method (eSewa / Khalti / Bank)
                  </label>
                  <div className="grid grid-cols-3 gap-2">
                    {(
                      ['ESEWA', 'KHALTI', 'BANK_TRANSFER'] as PaymentMethodCode[]
                    ).map((code) => {
                      const isSelected = withdrawMethod === code;
                      return (
                        <button
                          key={code}
                          type="button"
                          disabled={isBlocked || submitting}
                          onClick={() => setWithdrawMethod(code)}
                          className={`p-2 rounded-lg border text-left transition-colors cursor-pointer disabled:opacity-50 ${
                            isSelected
                              ? code === 'ESEWA'
                                ? 'bg-[#22ab68]/15 border-[#22ab68] text-white'
                                : code === 'KHALTI'
                                  ? 'bg-purple-500/15 border-purple-400 text-white'
                                  : 'bg-[#3898ff]/15 border-[#3898ff] text-white'
                              : 'bg-[#141722] border-[#2e3446] text-[#8c94ab] hover:text-white'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-1">
                            <span className="text-xs font-bold">
                              {getMethodLabel(code)}
                            </span>
                            {code === 'BANK_TRANSFER' ? (
                              <Landmark className="w-3.5 h-3.5 shrink-0" />
                            ) : (
                              <Smartphone className="w-3.5 h-3.5 shrink-0" />
                            )}
                          </div>
                          <div className="text-[10px] text-[#8c94ab] truncate mt-0.5">
                            {code === 'ESEWA'
                              ? 'eSewa Wallet ID'
                              : code === 'KHALTI'
                                ? 'Khalti Wallet ID'
                                : 'Nepal Bank A/C'}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="rounded-xl bg-[#141722] border border-[#2a3146] p-3.5 space-y-3">
                  <div className="text-xs font-bold text-white flex items-center justify-between">
                    <span>
                      2. {getMethodLabel(withdrawMethod)} Payout Details
                    </span>
                    <span className="text-[10px] font-mono text-[#8c94ab]">
                      Required *
                    </span>
                  </div>

                  {withdrawMethod === 'BANK_TRANSFER' ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label
                          htmlFor="modal-withdraw-bank-name"
                          className="block text-[11px] font-semibold text-slate-300 mb-1"
                        >
                          Bank Name *
                        </label>
                        <input
                          id="modal-withdraw-bank-name"
                          type="text"
                          required
                          maxLength={100}
                          disabled={isBlocked || submitting}
                          value={withdrawBankName}
                          onChange={(e) => setWithdrawBankName(e.target.value)}
                          placeholder="e.g., Nabil Bank / Global IME"
                          className="w-full h-10 px-3 rounded-lg bg-[#1c202e] border border-[#2e3446] focus:border-[#3898ff] focus:outline-none text-xs text-white disabled:opacity-50"
                        />
                      </div>

                      <div>
                        <label
                          htmlFor="modal-withdraw-branch-name"
                          className="block text-[11px] font-semibold text-slate-300 mb-1"
                        >
                          Branch Name (Optional)
                        </label>
                        <input
                          id="modal-withdraw-branch-name"
                          type="text"
                          maxLength={100}
                          disabled={isBlocked || submitting}
                          value={withdrawBranchName}
                          onChange={(e) => setWithdrawBranchName(e.target.value)}
                          placeholder="e.g., Kathmandu Main Branch"
                          className="w-full h-10 px-3 rounded-lg bg-[#1c202e] border border-[#2e3446] focus:border-[#3898ff] focus:outline-none text-xs text-white disabled:opacity-50"
                        />
                      </div>

                      <div>
                        <label
                          htmlFor="modal-withdraw-account-id"
                          className="block text-[11px] font-semibold text-slate-300 mb-1"
                        >
                          Bank Account Number *
                        </label>
                        <input
                          id="modal-withdraw-account-id"
                          type="text"
                          required
                          maxLength={60}
                          disabled={isBlocked || submitting}
                          value={withdrawAccountId}
                          onChange={(e) => setWithdrawAccountId(e.target.value)}
                          placeholder="e.g., 01201017500982"
                          className="w-full h-10 px-3 rounded-lg bg-[#1c202e] border border-[#2e3446] focus:border-[#3898ff] focus:outline-none text-xs font-mono text-white disabled:opacity-50"
                        />
                      </div>

                      <div>
                        <label
                          htmlFor="modal-withdraw-account-name"
                          className="block text-[11px] font-semibold text-slate-300 mb-1"
                        >
                          Account Holder Full Name *
                        </label>
                        <input
                          id="modal-withdraw-account-name"
                          type="text"
                          required
                          maxLength={100}
                          disabled={isBlocked || submitting}
                          value={withdrawAccountName}
                          onChange={(e) => setWithdrawAccountName(e.target.value)}
                          placeholder="Full name as per bank account"
                          className="w-full h-10 px-3 rounded-lg bg-[#1c202e] border border-[#2e3446] focus:border-[#3898ff] focus:outline-none text-xs text-white disabled:opacity-50"
                        />
                      </div>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label
                          htmlFor="modal-withdraw-wallet-id"
                          className="block text-[11px] font-semibold text-slate-300 mb-1"
                        >
                          {getMethodLabel(withdrawMethod)} ID / Mobile Number *
                        </label>
                        <input
                          id="modal-withdraw-wallet-id"
                          type="text"
                          required
                          maxLength={40}
                          disabled={isBlocked || submitting}
                          value={withdrawAccountId}
                          onChange={(e) => setWithdrawAccountId(e.target.value)}
                          placeholder="e.g., 9841XXXXXX"
                          className="w-full h-10 px-3 rounded-lg bg-[#1c202e] border border-[#2e3446] focus:border-[#22ab68] focus:outline-none text-xs font-mono text-white disabled:opacity-50"
                        />
                      </div>

                      <div>
                        <label
                          htmlFor="modal-withdraw-wallet-name"
                          className="block text-[11px] font-semibold text-slate-300 mb-1"
                        >
                          {getMethodLabel(withdrawMethod)} Account Holder Name *
                        </label>
                        <input
                          id="modal-withdraw-wallet-name"
                          type="text"
                          required
                          maxLength={100}
                          disabled={isBlocked || submitting}
                          value={withdrawAccountName}
                          onChange={(e) => setWithdrawAccountName(e.target.value)}
                          placeholder={`Full name on ${getMethodLabel(
                            withdrawMethod
                          )}`}
                          className="w-full h-10 px-3 rounded-lg bg-[#1c202e] border border-[#2e3446] focus:border-[#22ab68] focus:outline-none text-xs text-white disabled:opacity-50"
                        />
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label
                  htmlFor="modal-wallet-amount"
                  className="text-xs font-semibold text-slate-300"
                >
                  {mode === 'DEPOSIT'
                    ? `2. Deposit Amount (${currency})`
                    : `3. Withdrawal Amount (${currency})`}
                </label>
                <span className="text-[11px] font-mono text-[#8c94ab] tabular-nums">
                  {mode === 'DEPOSIT'
                    ? `Min ${limits.minDisplayFormatted} · Max ${limits.maxDisplayFormatted}`
                    : `Max Available: ${formatMoney(availableBalance)}`}
                </span>
              </div>

              <input
                id="modal-wallet-amount"
                type="number"
                step="0.01"
                min={limits.minDisplay}
                max={limits.maxDisplay}
                required
                disabled={isBlocked || submitting}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="w-full h-11 px-3.5 rounded-xl bg-[#141722] border border-[#2e3446] focus:border-[#3898ff] focus:outline-none text-sm font-mono font-bold text-white tabular-nums disabled:opacity-50"
              />

              {currency === 'NPR' && Number(amount) > 0 && (
                <div className="mt-1.5 px-3 py-1.5 rounded-lg bg-[#141722] border border-[#2a3042] text-[11px] font-mono text-[#9aa3ba] flex items-center justify-between tabular-nums">
                  <span>Base USDT Request Amount:</span>
                  <span className="font-bold text-white">
                    ${conversion.baseUsdtString} USDT
                    {conversion.wasRounded
                      ? ` (${conversion.exactDisplayFormatted})`
                      : ''}
                  </span>
                </div>
              )}

              <div className="grid grid-cols-4 gap-2 mt-2">
                {limits.quickAmountsDisplay.map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    disabled={isBlocked || submitting}
                    onClick={() => setAmount(String(preset))}
                    className="h-8 rounded-lg bg-[#252a3a] hover:bg-[#2f364a] text-[11px] font-mono font-bold text-slate-200 transition-colors cursor-pointer disabled:opacity-50 truncate px-1"
                  >
                    {mode === 'DEPOSIT' ? '+' : ''}
                    {currency === 'NPR'
                      ? `Rs ${preset.toLocaleString('en-US')}`
                      : `$${preset.toLocaleString('en-US')}`}
                  </button>
                ))}
              </div>
            </div>

            {mode === 'DEPOSIT' ? (
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label
                    htmlFor="modal-deposit-proof-upload"
                    className="flex items-center gap-1.5 text-xs font-semibold text-slate-300"
                  >
                    <ImageIcon className="w-3.5 h-3.5 text-[#22ab68]" />
                    <span>3. Payment Proof Screenshot *</span>
                  </label>
                  <span className="text-[11px] font-mono text-[#8c94ab]">
                    Max Size: 2 MB
                  </span>
                </div>

                <input
                  ref={depositFileInputRef}
                  id="modal-deposit-proof-upload"
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  disabled={isBlocked || submitting}
                  onChange={(e) => {
                    const file = e.target.files?.[0] || null;
                    setErrorMsg(null);
                    if (!file) {
                      setDepositProofFile(null);
                      setDepositProofPreview(null);
                      return;
                    }
                    const err = validatePaymentProofFile(file);
                    if (err) {
                      setDepositProofFile(null);
                      setDepositProofPreview(null);
                      e.target.value = '';
                      setErrorMsg(err);
                      onToast?.({ type: 'error', message: err });
                      return;
                    }
                    setDepositProofFile(file);
                    const reader = new FileReader();
                    reader.onload = () => {
                      setDepositProofPreview(
                        typeof reader.result === 'string'
                          ? reader.result
                          : null
                      );
                    };
                    reader.readAsDataURL(file);
                  }}
                  className="hidden"
                />

                {!depositProofFile ? (
                  <button
                    type="button"
                    disabled={isBlocked || submitting}
                    onClick={() => depositFileInputRef.current?.click()}
                    className="w-full p-4 rounded-xl bg-[#141722] hover:bg-[#181d2b] border border-dashed border-[#343b4f] hover:border-[#22ab68] transition-colors flex flex-col items-center justify-center gap-1.5 text-xs text-slate-300 cursor-pointer disabled:opacity-50"
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
                      {depositProofPreview && (
                        /* eslint-disable-next-line @next/next/no-img-element */
                        <img
                          src={depositProofPreview}
                          alt="Payment proof preview"
                          className="w-12 h-12 rounded-md object-cover border border-[#2e3446] shrink-0"
                        />
                      )}
                      <div className="min-w-0">
                        <div className="text-xs font-bold text-white truncate">
                          {depositProofFile.name}
                        </div>
                        <div className="text-[11px] font-mono text-[#22ab68]">
                          {(depositProofFile.size / 1024).toFixed(1)} KB / 2048 KB Max
                        </div>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setDepositProofFile(null);
                        setDepositProofPreview(null);
                        if (depositFileInputRef.current) {
                          depositFileInputRef.current.value = '';
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
            ) : (
              <div>
                <label
                  htmlFor="modal-wallet-note"
                  className="block text-xs font-semibold text-slate-300 mb-1.5"
                >
                  Additional Remarks (Optional — User ID: {displayUserNumber || '—'})
                </label>
                <input
                  id="modal-wallet-note"
                  type="text"
                  maxLength={180}
                  disabled={isBlocked || submitting}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="e.g., Please process payout to my account above"
                  className="w-full h-10 px-3.5 rounded-xl bg-[#141722] border border-[#2e3446] focus:border-[#3898ff] focus:outline-none text-xs text-white disabled:opacity-50"
                />
              </div>
            )}

            <div className="flex items-center justify-between text-[11px] text-[#8c94ab]">
              <span>Pending Requests: {pendingRequestsCount} / 3</span>
              <span>Balance unchanged until approved</span>
            </div>

            <button
              type="submit"
              disabled={
                submitting ||
                isBlocked ||
                pendingRequestsCount >= 3 ||
                (mode === 'DEPOSIT' && !depositProofFile) ||
                (mode === 'WITHDRAW' && availableBalance < 10)
              }
              className={`w-full min-h-[44px] py-2.5 px-4 rounded-xl text-xs font-bold text-white flex items-center justify-center gap-2 transition-colors cursor-pointer disabled:opacity-50 ${
                mode === 'DEPOSIT'
                  ? 'bg-[#22ab68] hover:bg-[#1e995d]'
                  : 'bg-[#e34c3b] hover:bg-[#cc3f30]'
              }`}
            >
              {mode === 'DEPOSIT' ? (
                <ArrowDownLeft className="w-4 h-4" />
              ) : (
                <ArrowUpRight className="w-4 h-4" />
              )}
              <span>
                {submitting
                  ? 'Submitting Request...'
                  : mode === 'DEPOSIT'
                    ? `Submit ${getMethodLabel(selectedMethod)} Deposit Proof`
                    : `Submit ${getMethodLabel(withdrawMethod)} Withdrawal Request`}
              </span>
            </button>
          </form>

          <div className="pt-3 border-t border-[#262b38] flex flex-wrap items-center justify-between gap-2 text-xs">
            <Link
              href="/wallet/payment-details"
              prefetch={false}
              onClick={onClose}
              className="font-bold text-[#22ab68] hover:underline flex items-center gap-1"
            >
              <QrCode className="w-3.5 h-3.5" />
              <span>Payment Details Page →</span>
            </Link>
            <Link
              href="/wallet"
              prefetch={false}
              onClick={onClose}
              className="font-bold text-[#3898ff] hover:underline flex items-center gap-1"
            >
              <Wallet className="w-3.5 h-3.5" />
              <span>Open Wallet Page →</span>
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
