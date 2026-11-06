'use client';

import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import Link from 'next/link';
import {
  Wallet,
  ArrowLeft,
  ArrowDownLeft,
  ArrowUpRight,
  Clock,
  User,
  Trophy,
  ChevronLeft,
  ChevronRight,
  Info,
  History,
  Copy,
  Check,
  Bell,
  Ban,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Terminal,
  Play,
  LogOut,
  Loader2,
  QrCode,
  ExternalLink,
  Landmark,
  Smartphone,
  Upload,
  Image as ImageIcon,
  Trash2,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import {
  BalanceLedgerRow,
  isSupabaseConfigured,
  ProfileRow,
  resolveUserNumber,
  UserNotificationRow,
  UserStatus,
  WalletRequestRow,
} from '@/lib/supabase/types';
import {
  isRealAuthenticatedUser,
  performFullLogout,
  useProtectedSessionGuard,
} from '@/lib/supabase/auth-utils';
import { ToastBanner } from '@/components/BalanceBadge';
import { WalletActionModal } from '@/components/WalletActionModal';
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
  parsePaymentProofFromNote,
  uploadPaymentProofScreenshot,
  validatePaymentProofFile,
} from '@/lib/payment-details';
import LoadingScreen from '@/components/LoadingScreen';

interface SupabaseErrorObject {
  message: string;
  code?: string;
  details?: string | null;
  hint?: string | null;
}

function formatSupabaseErrorMessage(
  err: SupabaseErrorObject,
  fallback: string
): string {
  const parts: string[] = [err.message || fallback];
  if (err.code) parts.push(`[Code: ${err.code}]`);
  if (err.details) parts.push(`Details: ${err.details}`);
  if (err.hint) parts.push(`Hint: ${err.hint}`);
  return parts.join(' ');
}

const LEDGER_PAGE_SIZE = 8;
const IS_DEV_MODE = process.env.NODE_ENV !== 'production';

export default function WalletPage() {
  const configured = isSupabaseConfigured();
  const { currency, rate, isFading, formatMoney, toBase } = useCurrency();
  const { isCheckingAuth, authenticatedUserId } =
    useProtectedSessionGuard('/wallet');

  const [userId, setUserId] = useState<string | null>(null);
  const [userNumber, setUserNumber] = useState<number | null>(null);
  const [userStatus, setUserStatus] = useState<UserStatus>('ACTIVE');
  const [copiedId, setCopiedId] = useState<boolean>(false);
  const [balance, setBalance] = useState<number>(0);

  const [walletModalOpen, setWalletModalOpen] = useState<boolean>(false);
  const [walletModalMode, setWalletModalMode] =
    useState<'DEPOSIT' | 'WITHDRAW'>('DEPOSIT');

  const [depositAmount, setDepositAmount] = useState<string>('500');
  const [depositProofFile, setDepositProofFile] = useState<File | null>(null);
  const [depositProofPreview, setDepositProofPreview] = useState<string | null>(
    null
  );
  const depositFileInputRef = useRef<HTMLInputElement | null>(null);
  const [submittingDeposit, setSubmittingDeposit] = useState<boolean>(false);
  const [depositSuccessBanner, setDepositSuccessBanner] = useState<
    string | null
  >(null);
  const [depositErrorBanner, setDepositErrorBanner] =
    useState<SupabaseErrorObject | null>(null);
  const [paymentDetails, setPaymentDetails] =
    useState<ManualPaymentDetailsState>(DEFAULT_MANUAL_PAYMENT_DETAILS);

  useEffect(() => {
    let active = true;
    fetch('/api/payment-details', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => {
        if (active && json?.paymentDetails) {
          setPaymentDetails(json.paymentDetails);
        }
      })
      .catch(() => {
        // Ignore network errors
      });
    return () => {
      active = false;
    };
  }, [walletModalOpen]);

  const [withdrawAmount, setWithdrawAmount] = useState<string>('250');
  const [withdrawMethod, setWithdrawMethod] =
    useState<PaymentMethodCode>('ESEWA');
  const [withdrawAccountId, setWithdrawAccountId] = useState<string>('');
  const [withdrawAccountName, setWithdrawAccountName] = useState<string>('');
  const [withdrawBankName, setWithdrawBankName] = useState<string>('');
  const [withdrawBranchName, setWithdrawBranchName] = useState<string>('');
  const [withdrawNote, setWithdrawNote] = useState<string>('');
  const [submittingWithdraw, setSubmittingWithdraw] = useState<boolean>(false);
  const [withdrawSuccessBanner, setWithdrawSuccessBanner] = useState<
    string | null
  >(null);
  const [withdrawErrorBanner, setWithdrawErrorBanner] =
    useState<SupabaseErrorObject | null>(null);

  const [loggingOut, setLoggingOut] = useState<boolean>(false);

  const prevCurrencyRef = useRef<CurrencyCode>(currency);
  const lastDepositBaseRef = useRef<number>(500);
  const lastWithdrawBaseRef = useRef<number>(250);

  const depositConversion = toBase(depositAmount);
  const withdrawConversion = toBase(withdrawAmount);

  useEffect(() => {
    if (
      Number.isFinite(depositConversion.baseUsdt) &&
      depositConversion.baseUsdt > 0
    ) {
      lastDepositBaseRef.current = depositConversion.baseUsdt;
    }
  }, [depositConversion.baseUsdt]);

  useEffect(() => {
    if (
      Number.isFinite(withdrawConversion.baseUsdt) &&
      withdrawConversion.baseUsdt > 0
    ) {
      lastWithdrawBaseRef.current = withdrawConversion.baseUsdt;
    }
  }, [withdrawConversion.baseUsdt]);

  useEffect(() => {
    if (prevCurrencyRef.current !== currency) {
      const nextDep = fromBaseToInputString(
        lastDepositBaseRef.current || 500,
        currency,
        rate
      );
      const nextWdr = fromBaseToInputString(
        lastWithdrawBaseRef.current || 250,
        currency,
        rate
      );
      setDepositAmount(nextDep.endsWith('.00') ? nextDep.slice(0, -3) : nextDep);
      setWithdrawAmount(
        nextWdr.endsWith('.00') ? nextWdr.slice(0, -3) : nextWdr
      );
      prevCurrencyRef.current = currency;
    }
  }, [currency, rate]);

  // Dev-Only Wallet Self-Test State
  const [selfTestRunning, setSelfTestRunning] = useState<
    'DEPOSIT' | 'WITHDRAW' | null
  >(null);
  const [selfTestOutput, setSelfTestOutput] = useState<
    Record<string, unknown> | null
  >(null);

  const [requests, setRequests] = useState<WalletRequestRow[]>([]);
  const [ledger, setLedger] = useState<BalanceLedgerRow[]>([]);
  const [notifications, setNotifications] = useState<UserNotificationRow[]>([]);
  const [notifOpen, setNotifOpen] = useState<boolean>(false);
  const notifRef = useRef<HTMLDivElement>(null);

  const [ledgerPage, setLedgerPage] = useState<number>(1);
  const [loading, setLoading] = useState<boolean>(true);

  const [toast, setToast] = useState<{
    type: 'success' | 'error' | 'info';
    message: string;
  } | null>(null);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) {
        setNotifOpen(false);
      }
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  const handleCopyUserNumber = async () => {
    if (!userNumber) return;
    try {
      await navigator.clipboard.writeText(String(userNumber));
      setCopiedId(true);
      setToast({ type: 'success', message: 'Copied' });
      setTimeout(() => setCopiedId(false), 1800);
    } catch {
      setToast({ type: 'info', message: `User ID: ${userNumber}` });
    }
  };

  const handleLogout = async () => {
    if (loggingOut) return;
    setLoggingOut(true);
    setUserId(null);
    setUserNumber(null);
    setBalance(0);
    setRequests([]);
    setLedger([]);
    setNotifications([]);
    await performFullLogout('logged_out');
  };

  const loadWalletData = useCallback(async () => {
    if (!configured || !authenticatedUserId) {
      return;
    }

    try {
      const supabase = createClient();
      setUserId(authenticatedUserId);

      const [profileRes, reqsRes, ledgerRes, notifRes] = await Promise.all([
        supabase
          .from('profiles')
          .select('*')
          .eq('id', authenticatedUserId)
          .maybeSingle(),
        supabase
          .from('wallet_requests')
          .select('*')
          .eq('user_id', authenticatedUserId)
          .order('created_at', { ascending: false })
          .limit(50),
        supabase
          .from('balance_ledger')
          .select('*')
          .eq('user_id', authenticatedUserId)
          .order('created_at', { ascending: false })
          .limit(120),
        supabase
          .from('user_notifications')
          .select('*')
          .eq('user_id', authenticatedUserId)
          .order('created_at', { ascending: false })
          .limit(25),
      ]);

      if (profileRes.error) {
        console.error('[WalletPage] Error loading profile:', {
          message: profileRes.error.message,
          code: profileRes.error.code,
          details: profileRes.error.details,
          hint: profileRes.error.hint,
        });
      }

      if (reqsRes.error) {
        console.error('[WalletPage] Error loading wallet_requests:', {
          message: reqsRes.error.message,
          code: reqsRes.error.code,
          details: reqsRes.error.details,
          hint: reqsRes.error.hint,
        });
      }

      if (profileRes.data) {
        const p = profileRes.data as ProfileRow;
        setBalance(Number(p.balance));
        setUserNumber(resolveUserNumber(p.user_number, authenticatedUserId));
        setUserStatus((p.status as UserStatus) || 'ACTIVE');
      } else {
        setUserNumber(resolveUserNumber(null, authenticatedUserId));
      }

      if (reqsRes.data) {
        setRequests(reqsRes.data as WalletRequestRow[]);
      }

      if (ledgerRes.data) {
        setLedger(ledgerRes.data as BalanceLedgerRow[]);
      }

      if (notifRes.data) {
        setNotifications(notifRes.data as UserNotificationRow[]);
      }
    } catch (err) {
      console.error('[WalletPage] Failed to load simulated wallet data:', err);
    } finally {
      setLoading(false);
    }
  }, [configured, authenticatedUserId]);

  useEffect(() => {
    if (!isCheckingAuth && authenticatedUserId) {
      void loadWalletData();
    }
  }, [isCheckingAuth, authenticatedUserId, loadWalletData]);

  // Live Realtime updates on profiles, wallet_requests, balance_ledger, and user_notifications
  useEffect(() => {
    if (!configured || !userId) return;

    const supabase = createClient();
    const channelId = `wallet_live_${userId}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

    const channel = supabase
      .channel(channelId)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'profiles',
          filter: `id=eq.${userId}`,
        },
        (payload) => {
          const updated = payload.new as ProfileRow;
          if (updated.balance !== undefined) {
            setBalance(Number(updated.balance));
          }
          if (updated.user_number) {
            setUserNumber(Number(updated.user_number));
          }
          if (updated.status) {
            setUserStatus(updated.status as UserStatus);
          }
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'wallet_requests',
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          if (payload.eventType === 'INSERT') {
            const inserted = payload.new as WalletRequestRow;
            setRequests((prev) => {
              if (prev.some((r) => r.id === inserted.id)) return prev;
              return [inserted, ...prev];
            });
          } else if (payload.eventType === 'UPDATE') {
            const updated = payload.new as WalletRequestRow;
            setRequests((prev) =>
              prev.map((r) => (r.id === updated.id ? updated : r))
            );
            if (updated.status === 'APPROVED') {
              const msg = `Your virtual ${updated.type.toLowerCase()} request of $${Number(
                updated.amount
              ).toFixed(2)} was APPROVED!`;
              setToast({ type: 'success', message: msg });
              setNotifications((prev) => [
                {
                  id: `rt-notif-${updated.id}-${Date.now()}`,
                  user_id: userId,
                  title: `${updated.type === 'DEPOSIT' ? 'Deposit' : 'Withdrawal'} Request Approved`,
                  message: msg,
                  type: 'REQUEST_APPROVED',
                  is_read: false,
                  created_at: new Date().toISOString(),
                },
                ...prev,
              ]);
            } else if (updated.status === 'REJECTED') {
              const msg = `Your virtual ${updated.type.toLowerCase()} request of $${Number(
                updated.amount
              ).toFixed(2)} was REJECTED.${
                updated.admin_note ? ` Note: ${updated.admin_note}` : ''
              }`;
              setToast({ type: 'error', message: msg });
              setNotifications((prev) => [
                {
                  id: `rt-notif-${updated.id}-${Date.now()}`,
                  user_id: userId,
                  title: `${updated.type === 'DEPOSIT' ? 'Deposit' : 'Withdrawal'} Request Rejected`,
                  message: msg,
                  type: 'REQUEST_REJECTED',
                  is_read: false,
                  created_at: new Date().toISOString(),
                },
                ...prev,
              ]);
            }
          }
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'balance_ledger',
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          const newEntry = payload.new as BalanceLedgerRow;
          setLedger((prev) => {
            if (prev.some((l) => l.id === newEntry.id)) return prev;
            return [newEntry, ...prev];
          });
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'user_notifications',
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          const newNotif = payload.new as UserNotificationRow;
          setNotifications((prev) => {
            if (prev.some((n) => n.id === newNotif.id)) return prev;
            return [newNotif, ...prev];
          });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [configured, userId]);

  const unreadNotifCount = useMemo(
    () => notifications.filter((n) => !n.is_read).length,
    [notifications]
  );

  const handleMarkAllRead = async () => {
    setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
    if (!configured || !userId) return;
    try {
      const supabase = createClient();
      await supabase.rpc('mark_notifications_read');
    } catch {
      // Ignore if table not yet migrated
    }
  };

  const pendingRequestsCount = useMemo(
    () => requests.filter((r) => r.status === 'PENDING').length,
    [requests]
  );

  const pendingWithdrawalsTotal = useMemo(
    () =>
      requests
        .filter((r) => r.status === 'PENDING' && r.type === 'WITHDRAW')
        .reduce((acc, r) => acc + Number(r.amount), 0),
    [requests]
  );

  const availableBalance = useMemo(
    () => Math.max(0, Number((balance - pendingWithdrawalsTotal).toFixed(2))),
    [balance, pendingWithdrawalsTotal]
  );

  const isSuspendedOrDisabled =
    userStatus === 'SUSPENDED' || userStatus === 'DISABLED';

  const depositLimits = getLimitsInCurrency(
    10,
    10000,
    [100, 500, 1000, 5000],
    currency,
    rate
  );
  const withdrawLimits = getLimitsInCurrency(
    10,
    10000,
    [50, 250, 500, 1000],
    currency,
    rate
  );

  async function handleDepositSubmit(e: React.FormEvent) {
    e.preventDefault();
    setDepositSuccessBanner(null);
    setDepositErrorBanner(null);

    if (isSuspendedOrDisabled) {
      const msg = `Account is ${userStatus}. Only ACTIVE users can create deposit requests.`;
      setDepositErrorBanner({ message: msg, code: 'ACCOUNT_NOT_ACTIVE' });
      setToast({ type: 'error', message: msg });
      return;
    }

    const rawInput = Number(depositAmount);
    if (
      !Number.isFinite(rawInput) ||
      !/^\d+(\.\d{1,2})?$/.test(depositAmount.trim())
    ) {
      const msg = 'Amount can have at most 2 decimal places.';
      setDepositErrorBanner({ message: msg, code: 'INVALID_PRECISION' });
      setToast({ type: 'error', message: msg });
      return;
    }

    const baseUsdt = depositConversion.baseUsdt;

    if (baseUsdt < 10 || baseUsdt > 10000) {
      const msg = `Deposit amount must be between ${depositLimits.minDisplayFormatted} and ${depositLimits.maxDisplayFormatted} ($10.00 – $10,000.00 USDT).`;
      setDepositErrorBanner({ message: msg, code: 'INVALID_AMOUNT' });
      setToast({ type: 'error', message: msg });
      return;
    }

    if (pendingRequestsCount >= 3) {
      const msg =
        'You already have 3 pending requests (maximum allowed). Wait for admin review.';
      setDepositErrorBanner({ message: msg, code: 'MAX_PENDING_EXCEEDED' });
      setToast({ type: 'error', message: msg });
      return;
    }

    const proofError = validatePaymentProofFile(depositProofFile);
    if (proofError || !depositProofFile) {
      const msg =
        proofError ||
        'Please upload a payment proof screenshot image (Max 2 MB).';
      setDepositErrorBanner({ message: msg, code: 'INVALID_PAYMENT_PROOF' });
      setToast({ type: 'error', message: msg });
      return;
    }

    const fxSuffix =
      currency === 'NPR' && rate
        ? `[Entered as ${depositConversion.exactDisplayFormatted} @ ${rate.toFixed(
            2
          )} = $${baseUsdt.toFixed(2)} USDT]`
        : '';

    setSubmittingDeposit(true);
    try {
      const uploadedProofUrl = await uploadPaymentProofScreenshot(
        depositProofFile,
        depositProofPreview
      );
      const noteWithUserId = buildPaymentProofNote({
        userNumber: userNumber ?? '—',
        screenshotUrl: uploadedProofUrl,
        currencySuffix: fxSuffix,
      });

      const supabase = createClient();

      const {
        data: { session },
      } = await supabase.auth.getSession();
      let activeUser = session?.user ?? null;
      if (!activeUser) {
        const {
          data: { user },
          error: authErr,
        } = await supabase.auth.getUser();
        if (authErr) {
          console.error('[WalletPage] Auth error on deposit submit:', {
            message: authErr.message,
            code: authErr.code,
            status: authErr.status,
          });
        }
        activeUser = user;
      }

      if (!activeUser || !isRealAuthenticatedUser(activeUser)) {
        const errObj: SupabaseErrorObject = {
          message:
            'Authentication required: You are not signed in. Please sign in before submitting a deposit request.',
          code: 'AUTH_SESSION_MISSING',
          details: 'No valid authenticated user session found.',
          hint: 'Sign in at /login and try again.',
        };
        setDepositErrorBanner(errObj);
        setToast({
          type: 'error',
          message: formatSupabaseErrorMessage(errObj, 'Authentication required.'),
        });
        return;
      }

      setUserId(activeUser.id);

      const { data, error } = await supabase.rpc('request_deposit', {
        p_amount: Number(baseUsdt.toFixed(2)),
        p_note: noteWithUserId,
      });

      if (error) {
        const errObj: SupabaseErrorObject = {
          message: error.message,
          code: error.code,
          details: error.details,
          hint: error.hint,
        };
        setDepositErrorBanner(errObj);
        setToast({
          type: 'error',
          message: formatSupabaseErrorMessage(
            errObj,
            'Failed to submit deposit request.'
          ),
        });
      } else {
        const created = data as WalletRequestRow | null;
        if (created) {
          const enriched: WalletRequestRow = {
            ...created,
            user_number: created.user_number ?? userNumber,
          };
          setRequests((prev) =>
            prev.some((r) => r.id === enriched.id) ? prev : [enriched, ...prev]
          );
        }
        setDepositProofFile(null);
        setDepositProofPreview(null);
        if (depositFileInputRef.current) {
          depositFileInputRef.current.value = '';
        }
        setDepositSuccessBanner('Your request was sent for admin approval');
        setToast({
          type: 'success',
          message: 'Your request was sent for admin approval',
        });
        await loadWalletData();
      }
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : 'Network error while submitting deposit request.';
      setDepositErrorBanner({ message: msg, code: 'NETWORK_EXCEPTION' });
      setToast({
        type: 'error',
        message: msg,
      });
    } finally {
      setSubmittingDeposit(false);
    }
  }

  async function handleWithdrawSubmit(e: React.FormEvent) {
    e.preventDefault();
    setWithdrawSuccessBanner(null);
    setWithdrawErrorBanner(null);

    if (isSuspendedOrDisabled) {
      const msg = `Account is ${userStatus}. Only ACTIVE users can create withdrawal requests.`;
      setWithdrawErrorBanner({ message: msg, code: 'ACCOUNT_NOT_ACTIVE' });
      setToast({ type: 'error', message: msg });
      return;
    }

    const rawInput = Number(withdrawAmount);
    if (
      !Number.isFinite(rawInput) ||
      !/^\d+(\.\d{1,2})?$/.test(withdrawAmount.trim())
    ) {
      const msg = 'Amount can have at most 2 decimal places.';
      setWithdrawErrorBanner({ message: msg, code: 'INVALID_PRECISION' });
      setToast({ type: 'error', message: msg });
      return;
    }

    const baseUsdt = withdrawConversion.baseUsdt;

    if (baseUsdt < 10 || baseUsdt > 10000) {
      const msg = `Withdrawal amount must be between ${withdrawLimits.minDisplayFormatted} and ${withdrawLimits.maxDisplayFormatted} ($10.00 – $10,000.00 USDT).`;
      setWithdrawErrorBanner({ message: msg, code: 'INVALID_AMOUNT' });
      setToast({ type: 'error', message: msg });
      return;
    }

    if (pendingRequestsCount >= 3) {
      const msg =
        'You already have 3 pending requests (maximum allowed). Wait for admin review.';
      setWithdrawErrorBanner({ message: msg, code: 'MAX_PENDING_EXCEEDED' });
      setToast({ type: 'error', message: msg });
      return;
    }

    if (baseUsdt > availableBalance) {
      const msg = `Insufficient available balance (${formatMoney(
        availableBalance
      )} after pending withdrawals).`;
      setWithdrawErrorBanner({
        message: msg,
        code: 'INSUFFICIENT_AVAILABLE_BALANCE',
      });
      setToast({ type: 'error', message: msg });
      return;
    }

    if (withdrawMethod === 'BANK_TRANSFER' && !withdrawBankName.trim()) {
      const msg = 'Please enter your Bank Name for the bank transfer withdrawal.';
      setWithdrawErrorBanner({ message: msg, code: 'MISSING_BANK_NAME' });
      setToast({ type: 'error', message: msg });
      return;
    }

    if (!withdrawAccountId.trim()) {
      const msg =
        withdrawMethod === 'BANK_TRANSFER'
          ? 'Please enter your Bank Account Number.'
          : `Please enter your ${getMethodLabel(withdrawMethod)} ID / Mobile Number.`;
      setWithdrawErrorBanner({ message: msg, code: 'MISSING_PAYOUT_ID' });
      setToast({ type: 'error', message: msg });
      return;
    }

    if (!withdrawAccountName.trim()) {
      const msg = `Please enter the ${
        withdrawMethod === 'BANK_TRANSFER'
          ? 'Bank Account Holder Name'
          : `${getMethodLabel(withdrawMethod)} Account Holder Name`
      }.`;
      setWithdrawErrorBanner({ message: msg, code: 'MISSING_PAYOUT_NAME' });
      setToast({ type: 'error', message: msg });
      return;
    }

    const fxSuffix =
      currency === 'NPR' && rate
        ? `[Entered as ${withdrawConversion.exactDisplayFormatted} @ ${rate.toFixed(
            2
          )} = $${baseUsdt.toFixed(2)} USDT]`
        : '';
    const noteWithUserId = buildWithdrawalPayoutNote({
      userNumber: userNumber ?? '—',
      methodCode: withdrawMethod,
      accountName: withdrawAccountName.trim(),
      accountIdentifier: withdrawAccountId.trim(),
      bankName: withdrawBankName.trim(),
      branchName: withdrawBranchName.trim(),
      userNote: withdrawNote.trim(),
      currencySuffix: fxSuffix,
    });

    setSubmittingWithdraw(true);
    try {
      const supabase = createClient();

      const {
        data: { session },
      } = await supabase.auth.getSession();
      let activeUser = session?.user ?? null;
      if (!activeUser) {
        const {
          data: { user },
          error: authErr,
        } = await supabase.auth.getUser();
        if (authErr) {
          console.error('[WalletPage] Auth error on withdraw submit:', {
            message: authErr.message,
            code: authErr.code,
            status: authErr.status,
          });
        }
        activeUser = user;
      }

      if (!activeUser || !isRealAuthenticatedUser(activeUser)) {
        const errObj: SupabaseErrorObject = {
          message:
            'Authentication required: You are not signed in. Please sign in before submitting a withdrawal request.',
          code: 'AUTH_SESSION_MISSING',
          details: 'No valid authenticated user session found.',
          hint: 'Sign in at /login and try again.',
        };
        setWithdrawErrorBanner(errObj);
        setToast({
          type: 'error',
          message: formatSupabaseErrorMessage(errObj, 'Authentication required.'),
        });
        return;
      }

      setUserId(activeUser.id);

      const { data, error } = await supabase.rpc('request_withdraw', {
        p_amount: Number(baseUsdt.toFixed(2)),
        p_note: noteWithUserId,
      });

      if (error) {
        const errObj: SupabaseErrorObject = {
          message: error.message,
          code: error.code,
          details: error.details,
          hint: error.hint,
        };
        setWithdrawErrorBanner(errObj);
        setToast({
          type: 'error',
          message: formatSupabaseErrorMessage(
            errObj,
            'Failed to submit withdrawal request.'
          ),
        });
      } else {
        const created = data as WalletRequestRow | null;
        if (created) {
          const enriched: WalletRequestRow = {
            ...created,
            user_number: created.user_number ?? userNumber,
          };
          setRequests((prev) =>
            prev.some((r) => r.id === enriched.id) ? prev : [enriched, ...prev]
          );
        }
        setWithdrawAccountId('');
        setWithdrawAccountName('');
        setWithdrawBankName('');
        setWithdrawBranchName('');
        setWithdrawNote('');
        setWithdrawSuccessBanner('Your request was sent for admin approval');
        setToast({
          type: 'success',
          message: 'Your request was sent for admin approval',
        });
        await loadWalletData();
      }
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : 'Network error while submitting withdrawal request.';
      setWithdrawErrorBanner({ message: msg, code: 'NETWORK_EXCEPTION' });
      setToast({
        type: 'error',
        message: msg,
      });
    } finally {
      setSubmittingWithdraw(false);
    }
  }

  async function handleRunSelfTest(testType: 'DEPOSIT' | 'WITHDRAW') {
    setSelfTestRunning(testType);
    const rpcName =
      testType === 'DEPOSIT' ? 'request_deposit' : 'request_withdraw';
    const testAmount = testType === 'DEPOSIT' ? 25.0 : 15.0;
    const testNote = `[SELF-TEST ${testType}] User ID: ${userNumber ?? '—'} @ ${new Date().toISOString()}`;

    try {
      const supabase = createClient();
      const {
        data: { user },
        error: authError,
      } = await supabase.auth.getUser();

      const { data, error } = await supabase.rpc(rpcName, {
        p_amount: testAmount,
        p_note: testNote,
      });

      const payload = {
        timestamp: new Date().toISOString(),
        supabaseConfigured: true,
        rpc: rpcName,
        params: { p_amount: testAmount, p_note: testNote },
        authUser: user
          ? { id: user.id, email: user.email, role: user.role }
          : null,
        authError: authError
          ? {
              message: authError.message,
              code: authError.code,
              status: authError.status,
            }
          : null,
        data: data ?? null,
        error: error
          ? {
              message: error.message,
              code: error.code,
              details: error.details,
              hint: error.hint,
            }
          : null,
      };

      if (error) {
        console.error(`[Wallet Self-Test] ${rpcName} FAILED:`, payload);
        setToast({
          type: 'error',
          message: formatSupabaseErrorMessage(
            {
              message: error.message,
              code: error.code,
              details: error.details,
              hint: error.hint,
            },
            `Self-test ${rpcName} failed`
          ),
        });
      } else {
        console.log(`[Wallet Self-Test] ${rpcName} SUCCEEDED:`, payload);
        setToast({
          type: 'success',
          message: `Self-test ${rpcName} succeeded! Your request was sent for admin approval`,
        });
        await loadWalletData();
      }

      setSelfTestOutput(payload);
    } catch (err) {
      const exPayload = {
        timestamp: new Date().toISOString(),
        rpc: rpcName,
        params: { p_amount: testAmount, p_note: testNote },
        exception: err instanceof Error ? err.message : String(err),
      };
      console.error('[Wallet Self-Test] Exception:', exPayload);
      setSelfTestOutput(exPayload);
    } finally {
      setSelfTestRunning(null);
    }
  }

  const totalLedgerPages = Math.max(
    1,
    Math.ceil(ledger.length / LEDGER_PAGE_SIZE)
  );
  const paginatedLedger = useMemo(() => {
    const start = (ledgerPage - 1) * LEDGER_PAGE_SIZE;
    return ledger.slice(start, start + LEDGER_PAGE_SIZE);
  }, [ledger, ledgerPage]);

  if (isCheckingAuth || !authenticatedUserId) {
    return (
      <LoadingScreen
        variant="fullscreen"
        label="Loading Account Wallet & Ledger"
      />
    );
  }

  return (
    <div className="flex-1 bg-[#171a23] text-slate-100 flex flex-col">
      {/* Header */}
      <header className="h-14 bg-[#1c202b] border-b border-[#262b38] px-4 lg:px-6 flex items-center justify-between gap-4">
        <div className="flex items-center gap-4 min-w-0">
          <Link
            href="/dashboard"
            prefetch={false}
            className="flex items-center gap-2 text-xs font-bold text-[#8c94ab] hover:text-white transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Back to Terminal</span>
          </Link>
          <span className="text-[#2e3446]" aria-hidden="true">
            /
          </span>
          <div className="flex items-center gap-2">
            <Wallet className="w-4 h-4 text-[#22ab68]" />
            <h1 className="text-sm font-bold text-white truncate">
              Account Wallet
            </h1>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          {/* Currency Toggle Button */}
          <CurrencyToggleButton />

          {/* 5-Digit User ID Pill */}
          <div className="hidden md:flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-[#141722] border border-[#2e3446]">
            <span className="text-xs font-mono font-bold text-slate-300">
              User ID:{' '}
              <span className="text-[#3898ff]">{userNumber ?? '—'}</span>
            </span>
            {userNumber && (
              <button
                type="button"
                onClick={handleCopyUserNumber}
                title="Copy 5-Digit User ID"
                className="p-1 rounded hover:bg-[#252a3a] text-[#8c94ab] hover:text-white cursor-pointer"
              >
                {copiedId ? (
                  <Check className="w-3.5 h-3.5 text-[#22ab68]" />
                ) : (
                  <Copy className="w-3.5 h-3.5" />
                )}
              </button>
            )}
          </div>

          {/* Header Payment Details Link */}
          <Link
            href="/wallet/payment-details"
            prefetch={false}
            className="h-9 px-3 rounded-lg bg-[#141722] hover:bg-[#252a3a] border border-[#22ab68]/40 text-[#22ab68] font-bold text-xs hidden md:flex items-center gap-1.5 transition-colors"
          >
            <QrCode className="w-3.5 h-3.5" />
            <span>Payment Details</span>
          </Link>

          <nav className="hidden sm:flex items-center gap-3 pl-2 border-l border-[#262b38] text-xs font-semibold text-[#8c94ab]">
            <Link
              href="/profile"
              prefetch={false}
              className="hover:text-white transition-colors flex items-center gap-1.5"
            >
              <User className="w-3.5 h-3.5 text-[#3898ff]" />
              <span>Profile</span>
            </Link>
            <Link
              href="/leaderboard"
              prefetch={false}
              className="hidden lg:flex hover:text-white transition-colors items-center gap-1.5"
            >
              <Trophy className="w-3.5 h-3.5 text-[#f59e0b]" />
              <span>Leaderboard</span>
            </Link>
            <button
              type="button"
              disabled={loggingOut}
              onClick={handleLogout}
              className="h-9 px-3 rounded-lg bg-[#252a3a] hover:bg-[#31384d] border border-[#343b4f] text-slate-200 hover:text-white font-bold flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50"
            >
              <LogOut className="w-3.5 h-3.5 text-[#e34c3b]" />
              <span>{loggingOut ? '...' : 'Log Out'}</span>
            </button>
          </nav>
        </div>
      </header>

      <main className="flex-1 max-w-6xl w-full mx-auto p-4 sm:p-6 space-y-6">
        {/* Live Account Identity Bar */}
        <div
          role="note"
          className="bg-[#1c2233] border border-[#2e3852] rounded-xl px-4 py-3.5 flex flex-wrap items-center justify-between gap-3"
        >
          <div className="flex items-center gap-2.5">
            <Info className="w-4 h-4 text-[#22ab68] shrink-0" />
            <span className="text-xs sm:text-sm font-bold text-white">
              Live Account Wallet · Instant Deposit &amp; Withdrawal Requests
            </span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs font-mono font-bold text-slate-200">
              User ID:{' '}
              <span className="text-[#3898ff]">{userNumber ?? '—'}</span>
            </span>
            {userNumber && (
              <button
                type="button"
                onClick={handleCopyUserNumber}
                className="inline-flex items-center gap-1 px-2 py-1 rounded bg-[#252a3a] hover:bg-[#31384d] text-[11px] font-bold text-slate-200 cursor-pointer"
              >
                {copiedId ? (
                  <>
                    <Check className="w-3 h-3 text-[#22ab68]" />
                    <span className="text-[#22ab68]">Copied</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3 h-3 text-[#8c94ab]" />
                    <span>Copy ID</span>
                  </>
                )}
              </button>
            )}
          </div>
        </div>

        {/* Suspended / Disabled Warning */}
        {isSuspendedOrDisabled && (
          <div className="rounded-xl bg-[#e34c3b]/15 border border-[#e34c3b]/40 p-4 flex items-center gap-3 text-xs text-rose-200">
            <Ban className="w-5 h-5 text-[#e34c3b] shrink-0" />
            <div>
              <div className="font-bold text-white">
                Account Status: {userStatus}
              </div>
              <p className="mt-0.5">
                Suspended or banned accounts are blocked from creating new deposit or withdrawal requests.
              </p>
            </div>
          </div>
        )}

        {/* Balance Overview Card */}
        <section className="bg-[#1c202b] border border-[#2e3446] rounded-xl p-5 sm:p-6 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-6 flex-1">
            <div>
              <div className="text-xs font-semibold text-[#8c94ab]">
                5-Digit User ID
              </div>
              <div className="flex items-center gap-2 mt-1">
                <span className="text-2xl sm:text-3xl font-extrabold font-mono text-[#3898ff] tabular-nums">
                  {userNumber ?? '—'}
                </span>
                {userNumber && (
                  <button
                    type="button"
                    onClick={handleCopyUserNumber}
                    className="p-1.5 rounded-lg bg-[#252a3a] hover:bg-[#2e3446] text-xs text-slate-300 cursor-pointer"
                    title="Copy User ID"
                  >
                    {copiedId ? (
                      <Check className="w-4 h-4 text-[#22ab68]" />
                    ) : (
                      <Copy className="w-4 h-4" />
                    )}
                  </button>
                )}
              </div>
              <div className="text-[11px] text-[#7c849b] mt-1">
                Included in all support &amp; wallet requests
              </div>
            </div>

            <div>
              <div className="text-xs font-semibold text-[#8c94ab]">
                Live Account Balance ({currency})
              </div>
              <div
                className={`text-2xl sm:text-3xl font-extrabold font-mono text-white tabular-nums mt-1 transition-opacity duration-150 ${
                  isFading ? 'opacity-30' : 'opacity-100'
                }`}
              >
                {formatMoney(balance)}
              </div>
              <div className="text-[11px] text-[#7c849b] mt-1 font-mono tabular-nums">
                {currency === 'NPR'
                  ? `Base: $${balance.toLocaleString('en-US', {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })} USDT`
                  : 'Live synced via public.profiles'}
              </div>
            </div>

            <div>
              <div className="text-xs font-semibold text-[#8c94ab]">
                Available for Withdrawal
              </div>
              <div
                className={`text-2xl sm:text-3xl font-extrabold font-mono text-[#22ab68] tabular-nums mt-1 transition-opacity duration-150 ${
                  isFading ? 'opacity-30' : 'opacity-100'
                }`}
              >
                {formatMoney(availableBalance)}
              </div>
              <div className="text-[11px] text-[#7c849b] mt-1 font-mono tabular-nums">
                {formatMoney(pendingWithdrawalsTotal)} in pending withdrawals
              </div>
            </div>

            <div>
              <div className="text-xs font-semibold text-[#8c94ab]">
                Active Pending Requests
              </div>
              <div className="text-2xl sm:text-3xl font-extrabold font-mono text-[#f59e0b] tabular-nums mt-1">
                {pendingRequestsCount} / 3
              </div>
              <div className="text-[11px] text-[#7c849b] mt-1">
                Maximum 3 concurrent pending requests
              </div>
            </div>
          </div>
        </section>

        {/* Deposit & Withdraw Forms */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Request Deposit Card */}
          <section className="bg-[#1c202b] border border-[#2e3446] rounded-xl p-5 sm:p-6 flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between pb-3 border-b border-[#262b38]">
                <div className="flex items-center gap-2">
                  <ArrowDownLeft className="w-4 h-4 text-[#22ab68]" />
                  <h2 className="text-sm font-bold text-white">
                    Request Deposit
                  </h2>
                </div>
                <span className="text-[11px] font-mono text-[#8c94ab] tabular-nums">
                  User ID: {userNumber ?? '—'} ·{' '}
                  {depositLimits.minDisplayFormatted} –{' '}
                  {depositLimits.maxDisplayFormatted}
                </span>
              </div>

              <p className="text-xs text-[#8c94ab] mt-3">
                Submits a{' '}
                <code className="text-slate-300">PENDING</code> deposit request via{' '}
                <code className="text-slate-300">request_deposit</code>.
              </p>

              {(paymentDetails.hideDepositDetails ||
                (paymentDetails.showDepositMessageBanner &&
                  paymentDetails.depositMessage?.trim())) && (
                <div className="mt-3 p-3.5 rounded-lg bg-amber-500/10 border border-amber-500/35 space-y-1.5 text-xs">
                  <div className="font-bold text-amber-300 flex items-center gap-1.5">
                    <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
                    <span>
                      {paymentDetails.hideDepositDetails
                        ? 'Deposit Notice from Administrator'
                        : 'Important Deposit Message'}
                    </span>
                  </div>
                  <p className="text-slate-100 leading-relaxed whitespace-pre-line">
                    {paymentDetails.depositMessage?.trim() ||
                      'Manual deposit account details are temporarily hidden by the administrator. Please contact support or check back shortly for updated deposit instructions.'}
                  </p>
                </div>
              )}

              {depositErrorBanner && (
                <div className="mt-3 rounded-lg bg-[#e34c3b]/15 border border-[#e34c3b]/40 p-3 text-xs text-red-200 space-y-1">
                  <div className="flex items-start gap-2 font-bold">
                    <AlertCircle className="w-4 h-4 text-[#e34c3b] shrink-0 mt-0.5" />
                    <span>{depositErrorBanner.message}</span>
                  </div>
                  {(depositErrorBanner.code ||
                    depositErrorBanner.details ||
                    depositErrorBanner.hint) && (
                    <div className="pl-6 font-mono text-[11px] text-red-300/90 space-y-0.5 break-all">
                      {depositErrorBanner.code && (
                        <div>code: {depositErrorBanner.code}</div>
                      )}
                      {depositErrorBanner.details && (
                        <div>details: {depositErrorBanner.details}</div>
                      )}
                      {depositErrorBanner.hint && (
                        <div>hint: {depositErrorBanner.hint}</div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {depositSuccessBanner && (
                <div className="mt-3 rounded-lg bg-[#22ab68]/15 border border-[#22ab68]/40 p-3 flex items-center gap-2 text-xs font-bold text-emerald-200">
                  <CheckCircle2 className="w-4 h-4 text-[#22ab68] shrink-0" />
                  <span>{depositSuccessBanner}</span>
                </div>
              )}

              <form onSubmit={handleDepositSubmit} className="mt-4 space-y-4">
                <div>
                  <label
                    htmlFor="deposit-amount"
                    className="block text-xs font-semibold text-slate-300 mb-1.5"
                  >
                    Deposit Amount ({currency})
                  </label>
                  <input
                    id="deposit-amount"
                    type="number"
                    step="0.01"
                    min={depositLimits.minDisplay}
                    max={depositLimits.maxDisplay}
                    required
                    disabled={isSuspendedOrDisabled}
                    value={depositAmount}
                    onChange={(e) => setDepositAmount(e.target.value)}
                    className="w-full h-11 px-3.5 rounded-lg bg-[#141722] border border-[#2e3446] focus:border-[#22ab68] focus:outline-none text-sm font-mono font-bold text-white tabular-nums disabled:opacity-50"
                  />

                  {currency === 'NPR' && Number(depositAmount) > 0 && (
                    <div className="mt-1.5 px-3 py-1.5 rounded-lg bg-[#141722] border border-[#2a3042] text-[11px] font-mono text-[#9aa3ba] flex items-center justify-between tabular-nums">
                      <span>Base USDT Deposit Amount:</span>
                      <span className="font-bold text-white">
                        ${depositConversion.baseUsdtString} USDT
                        {depositConversion.wasRounded
                          ? ` (${depositConversion.exactDisplayFormatted})`
                          : ''}
                      </span>
                    </div>
                  )}

                  <div className="grid grid-cols-4 gap-2 mt-2">
                    {depositLimits.quickAmountsDisplay.map((preset) => (
                      <button
                        key={preset}
                        type="button"
                        disabled={isSuspendedOrDisabled}
                        onClick={() => setDepositAmount(String(preset))}
                        className="h-8 rounded-md bg-[#252a3a] hover:bg-[#2e3446] text-[11px] font-mono font-bold text-slate-200 transition-colors cursor-pointer disabled:opacity-50 truncate px-1"
                      >
                        +
                        {currency === 'NPR'
                          ? `Rs ${preset.toLocaleString('en-US')}`
                          : `$${preset.toLocaleString('en-US')}`}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label
                      htmlFor="deposit-proof-upload"
                      className="flex items-center gap-1.5 text-xs font-semibold text-slate-300"
                    >
                      <ImageIcon className="w-3.5 h-3.5 text-[#22ab68]" />
                      <span>Payment Proof Screenshot *</span>
                    </label>
                    <span className="text-[11px] font-mono text-[#8c94ab]">
                      Max Size: 2 MB
                    </span>
                  </div>

                  <input
                    ref={depositFileInputRef}
                    id="deposit-proof-upload"
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/gif"
                    disabled={isSuspendedOrDisabled || submittingDeposit}
                    onChange={(e) => {
                      const file = e.target.files?.[0] || null;
                      setDepositErrorBanner(null);
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
                        setDepositErrorBanner({
                          message: err,
                          code: 'FILE_TOO_LARGE_OR_INVALID',
                        });
                        setToast({ type: 'error', message: err });
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
                      disabled={isSuspendedOrDisabled || submittingDeposit}
                      onClick={() => depositFileInputRef.current?.click()}
                      className="w-full p-4 rounded-lg bg-[#141722] hover:bg-[#181d2b] border border-dashed border-[#343b4f] hover:border-[#22ab68] transition-colors flex flex-col items-center justify-center gap-1.5 text-xs text-slate-300 cursor-pointer disabled:opacity-50"
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
                    <div className="p-3 rounded-lg bg-[#141722] border border-[#22ab68]/40 flex items-center justify-between gap-3">
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

                <button
                  type="submit"
                  disabled={
                    submittingDeposit ||
                    !depositProofFile ||
                    pendingRequestsCount >= 3 ||
                    isSuspendedOrDisabled
                  }
                  className="min-h-[44px] w-full py-2.5 px-4 rounded-lg bg-[#22ab68] hover:bg-[#1e995d] disabled:opacity-50 text-xs font-bold text-white flex items-center justify-center gap-2 transition-colors cursor-pointer"
                >
                  <ArrowDownLeft className="w-4 h-4" />
                  <span>
                    {submittingDeposit
                      ? 'Uploading Proof & Submitting...'
                      : 'Submit Deposit Request'}
                  </span>
                </button>
              </form>
            </div>
          </section>

          {/* Request Withdrawal Card */}
          <section className="bg-[#1c202b] border border-[#2e3446] rounded-xl p-5 sm:p-6 flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between pb-3 border-b border-[#262b38]">
                <div className="flex items-center gap-2">
                  <ArrowUpRight className="w-4 h-4 text-[#e34c3b]" />
                  <h2 className="text-sm font-bold text-white">
                    Request Withdrawal
                  </h2>
                </div>
                <span className="text-[11px] font-mono text-[#22ab68] font-bold tabular-nums">
                  Available: {formatMoney(availableBalance)}
                </span>
              </div>

              <p className="text-xs text-[#8c94ab] mt-3">
                Balance is not deducted until an admin approves the request.
              </p>

              {withdrawErrorBanner && (
                <div className="mt-3 rounded-lg bg-[#e34c3b]/15 border border-[#e34c3b]/40 p-3 text-xs text-red-200 space-y-1">
                  <div className="flex items-start gap-2 font-bold">
                    <AlertCircle className="w-4 h-4 text-[#e34c3b] shrink-0 mt-0.5" />
                    <span>{withdrawErrorBanner.message}</span>
                  </div>
                  {(withdrawErrorBanner.code ||
                    withdrawErrorBanner.details ||
                    withdrawErrorBanner.hint) && (
                    <div className="pl-6 font-mono text-[11px] text-red-300/90 space-y-0.5 break-all">
                      {withdrawErrorBanner.code && (
                        <div>code: {withdrawErrorBanner.code}</div>
                      )}
                      {withdrawErrorBanner.details && (
                        <div>details: {withdrawErrorBanner.details}</div>
                      )}
                      {withdrawErrorBanner.hint && (
                        <div>hint: {withdrawErrorBanner.hint}</div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {withdrawSuccessBanner && (
                <div className="mt-3 rounded-lg bg-[#22ab68]/15 border border-[#22ab68]/40 p-3 flex items-center gap-2 text-xs font-bold text-emerald-200">
                  <CheckCircle2 className="w-4 h-4 text-[#22ab68] shrink-0" />
                  <span>{withdrawSuccessBanner}</span>
                </div>
              )}

              <form onSubmit={handleWithdrawSubmit} className="mt-4 space-y-4">
                {/* Payout Method Selector */}
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
                          disabled={isSuspendedOrDisabled}
                          onClick={() => setWithdrawMethod(code)}
                          className={`p-2.5 rounded-lg border text-left transition-colors cursor-pointer disabled:opacity-50 ${
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

                {/* Dynamic Payout Destination Fields */}
                <div className="rounded-lg bg-[#141722] border border-[#2a3146] p-3.5 space-y-3">
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
                          htmlFor="withdraw-bank-name"
                          className="block text-[11px] font-semibold text-slate-300 mb-1"
                        >
                          Bank Name *
                        </label>
                        <input
                          id="withdraw-bank-name"
                          type="text"
                          required
                          maxLength={100}
                          disabled={isSuspendedOrDisabled}
                          value={withdrawBankName}
                          onChange={(e) => setWithdrawBankName(e.target.value)}
                          placeholder="e.g., Nabil Bank / Global IME"
                          className="w-full h-10 px-3 rounded-lg bg-[#1c202b] border border-[#2e3446] focus:border-[#3898ff] focus:outline-none text-xs text-white disabled:opacity-50"
                        />
                      </div>

                      <div>
                        <label
                          htmlFor="withdraw-branch-name"
                          className="block text-[11px] font-semibold text-slate-300 mb-1"
                        >
                          Branch Name (Optional)
                        </label>
                        <input
                          id="withdraw-branch-name"
                          type="text"
                          maxLength={100}
                          disabled={isSuspendedOrDisabled}
                          value={withdrawBranchName}
                          onChange={(e) => setWithdrawBranchName(e.target.value)}
                          placeholder="e.g., Kathmandu Main Branch"
                          className="w-full h-10 px-3 rounded-lg bg-[#1c202b] border border-[#2e3446] focus:border-[#3898ff] focus:outline-none text-xs text-white disabled:opacity-50"
                        />
                      </div>

                      <div>
                        <label
                          htmlFor="withdraw-account-id"
                          className="block text-[11px] font-semibold text-slate-300 mb-1"
                        >
                          Bank Account Number *
                        </label>
                        <input
                          id="withdraw-account-id"
                          type="text"
                          required
                          maxLength={60}
                          disabled={isSuspendedOrDisabled}
                          value={withdrawAccountId}
                          onChange={(e) => setWithdrawAccountId(e.target.value)}
                          placeholder="e.g., 01201017500982"
                          className="w-full h-10 px-3 rounded-lg bg-[#1c202b] border border-[#2e3446] focus:border-[#3898ff] focus:outline-none text-xs font-mono text-white disabled:opacity-50"
                        />
                      </div>

                      <div>
                        <label
                          htmlFor="withdraw-account-name"
                          className="block text-[11px] font-semibold text-slate-300 mb-1"
                        >
                          Account Holder Full Name *
                        </label>
                        <input
                          id="withdraw-account-name"
                          type="text"
                          required
                          maxLength={100}
                          disabled={isSuspendedOrDisabled}
                          value={withdrawAccountName}
                          onChange={(e) => setWithdrawAccountName(e.target.value)}
                          placeholder="Full name as per bank account"
                          className="w-full h-10 px-3 rounded-lg bg-[#1c202b] border border-[#2e3446] focus:border-[#3898ff] focus:outline-none text-xs text-white disabled:opacity-50"
                        />
                      </div>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label
                          htmlFor="withdraw-wallet-id"
                          className="block text-[11px] font-semibold text-slate-300 mb-1"
                        >
                          {getMethodLabel(withdrawMethod)} ID / Mobile Number *
                        </label>
                        <input
                          id="withdraw-wallet-id"
                          type="text"
                          required
                          maxLength={40}
                          disabled={isSuspendedOrDisabled}
                          value={withdrawAccountId}
                          onChange={(e) => setWithdrawAccountId(e.target.value)}
                          placeholder="e.g., 9841XXXXXX"
                          className="w-full h-10 px-3 rounded-lg bg-[#1c202b] border border-[#2e3446] focus:border-[#22ab68] focus:outline-none text-xs font-mono text-white disabled:opacity-50"
                        />
                      </div>

                      <div>
                        <label
                          htmlFor="withdraw-wallet-name"
                          className="block text-[11px] font-semibold text-slate-300 mb-1"
                        >
                          {getMethodLabel(withdrawMethod)} Account Holder Name *
                        </label>
                        <input
                          id="withdraw-wallet-name"
                          type="text"
                          required
                          maxLength={100}
                          disabled={isSuspendedOrDisabled}
                          value={withdrawAccountName}
                          onChange={(e) => setWithdrawAccountName(e.target.value)}
                          placeholder={`Full name on ${getMethodLabel(
                            withdrawMethod
                          )}`}
                          className="w-full h-10 px-3 rounded-lg bg-[#1c202b] border border-[#2e3446] focus:border-[#22ab68] focus:outline-none text-xs text-white disabled:opacity-50"
                        />
                      </div>
                    </div>
                  )}
                </div>

                <div>
                  <label
                    htmlFor="withdraw-amount"
                    className="block text-xs font-semibold text-slate-300 mb-1.5"
                  >
                    3. Withdrawal Amount ({currency})
                  </label>
                  <input
                    id="withdraw-amount"
                    type="number"
                    step="0.01"
                    min={withdrawLimits.minDisplay}
                    max={withdrawLimits.maxDisplay}
                    required
                    disabled={isSuspendedOrDisabled}
                    value={withdrawAmount}
                    onChange={(e) => setWithdrawAmount(e.target.value)}
                    className="w-full h-11 px-3.5 rounded-lg bg-[#141722] border border-[#2e3446] focus:border-[#e34c3b] focus:outline-none text-sm font-mono font-bold text-white tabular-nums disabled:opacity-50"
                  />

                  {currency === 'NPR' && Number(withdrawAmount) > 0 && (
                    <div className="mt-1.5 px-3 py-1.5 rounded-lg bg-[#141722] border border-[#2a3042] text-[11px] font-mono text-[#9aa3ba] flex items-center justify-between tabular-nums">
                      <span>Base USDT Withdrawal Amount:</span>
                      <span className="font-bold text-white">
                        ${withdrawConversion.baseUsdtString} USDT
                        {withdrawConversion.wasRounded
                          ? ` (${withdrawConversion.exactDisplayFormatted})`
                          : ''}
                      </span>
                    </div>
                  )}

                  <div className="grid grid-cols-4 gap-2 mt-2">
                    {withdrawLimits.quickAmountsDisplay.map((preset) => (
                      <button
                        key={preset}
                        type="button"
                        disabled={isSuspendedOrDisabled}
                        onClick={() => setWithdrawAmount(String(preset))}
                        className="h-8 rounded-md bg-[#252a3a] hover:bg-[#2e3446] text-[11px] font-mono font-bold text-slate-200 transition-colors cursor-pointer disabled:opacity-50 truncate px-1"
                      >
                        {currency === 'NPR'
                          ? `Rs ${preset.toLocaleString('en-US')}`
                          : `$${preset.toLocaleString('en-US')}`}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label
                    htmlFor="withdraw-note"
                    className="block text-xs font-semibold text-slate-300 mb-1.5"
                  >
                    Additional Remarks (Optional — User ID {userNumber ?? '—'} attached automatically)
                  </label>
                  <input
                    id="withdraw-note"
                    type="text"
                    maxLength={280}
                    disabled={isSuspendedOrDisabled}
                    value={withdrawNote}
                    onChange={(e) => setWithdrawNote(e.target.value)}
                    placeholder="e.g., Please process to my wallet above"
                    className="w-full h-10 px-3.5 rounded-lg bg-[#141722] border border-[#2e3446] focus:border-[#e34c3b] focus:outline-none text-xs text-white disabled:opacity-50"
                  />
                </div>

                <button
                  type="submit"
                  disabled={
                    submittingWithdraw ||
                    pendingRequestsCount >= 3 ||
                    availableBalance < 10 ||
                    isSuspendedOrDisabled
                  }
                  className="min-h-[44px] w-full py-2.5 px-4 rounded-lg bg-[#e34c3b] hover:bg-[#cc3f30] disabled:opacity-50 text-xs font-bold text-white flex items-center justify-center gap-2 transition-colors cursor-pointer"
                >
                  <ArrowUpRight className="w-4 h-4" />
                  <span>
                    {submittingWithdraw
                      ? 'Submitting Withdrawal Request...'
                      : `Submit ${getMethodLabel(withdrawMethod)} Withdrawal Request`}
                  </span>
                </button>
              </form>
            </div>
          </section>
        </div>

        {/* Wallet Requests Table */}
        <section className="bg-[#1c202b] border border-[#2e3446] rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-[#262b38] flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-[#f59e0b]" />
              <h2 className="text-sm font-bold text-white">
                Wallet Requests ({requests.length})
              </h2>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-xs text-[#8c94ab]">
                Realtime updates via <code className="text-slate-300">public.wallet_requests</code>
              </span>
              <button
                type="button"
                onClick={() => loadWalletData()}
                className="px-2.5 py-1 rounded bg-[#252a3a] hover:bg-[#31384d] text-[11px] font-bold text-slate-200 cursor-pointer"
              >
                Refresh
              </button>
            </div>
          </div>

          {loading ? (
            <div className="p-8 text-center text-xs text-[#8c94ab]">
              Loading wallet requests...
            </div>
          ) : requests.length === 0 ? (
            <div className="p-8 text-center text-xs text-[#8c94ab]">
              No deposit or withdrawal requests yet. Use the buttons or forms above to submit a request.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-[#262b38] text-[#7c849b] bg-[#171a23]/50">
                    <th className="py-3 px-4 font-semibold">Date</th>
                    <th className="py-3 px-4 font-semibold">User ID</th>
                    <th className="py-3 px-4 font-semibold">Type</th>
                    <th className="py-3 px-4 font-semibold">Amount</th>
                    <th className="py-3 px-4 font-semibold">Status</th>
                    <th className="py-3 px-4 font-semibold">Trader Note</th>
                    <th className="py-3 px-4 font-semibold">Admin Note</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#262b38]">
                  {requests.map((req) => {
                    const amt = Number(req.amount);
                    const reqUserNum = req.user_number ?? userNumber ?? '—';
                    return (
                      <tr
                        key={req.id}
                        className="hover:bg-[#232837]/50 transition-colors"
                      >
                        <td className="py-3 px-4 font-mono text-[#8c94ab] tabular-nums whitespace-nowrap">
                          <div>{new Date(req.created_at).toLocaleString()}</div>
                          {req.reviewed_at && (
                            <div className="text-[10px] text-slate-400">
                              Reviewed{' '}
                              {new Date(req.reviewed_at).toLocaleTimeString()}
                            </div>
                          )}
                        </td>
                        <td className="py-3 px-4 font-mono font-bold text-[#3898ff]">
                          {reqUserNum}
                        </td>
                        <td className="py-3 px-4 font-bold">
                          <span
                            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-mono ${
                              req.type === 'DEPOSIT'
                                ? 'bg-[#22ab68]/15 text-[#22ab68]'
                                : 'bg-[#e34c3b]/15 text-[#e34c3b]'
                            }`}
                          >
                            {req.type}
                          </span>
                        </td>
                        <td
                          className={`py-3 px-4 font-mono font-bold text-white tabular-nums transition-opacity duration-150 ${
                            isFading ? 'opacity-30' : 'opacity-100'
                          }`}
                        >
                          <div>
                            {formatMoney(
                              req.type === 'DEPOSIT' ? amt : -amt,
                              { showPlusSign: req.type === 'DEPOSIT' }
                            )}
                          </div>
                          {currency === 'NPR' && (
                            <div className="text-[10px] text-[#7c849b] font-normal">
                              Base: ${amt.toFixed(2)}
                            </div>
                          )}
                        </td>
                        <td className="py-3 px-4 font-mono font-bold">
                          <span
                            className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] ${
                              req.status === 'APPROVED'
                                ? 'bg-[#22ab68]/15 text-[#22ab68] border border-[#22ab68]/30'
                                : req.status === 'REJECTED'
                                  ? 'bg-[#e34c3b]/15 text-[#e34c3b] border border-[#e34c3b]/30'
                                  : 'bg-[#f59e0b]/15 text-[#f59e0b] border border-[#f59e0b]/30'
                            }`}
                          >
                            {req.status === 'APPROVED' && (
                              <CheckCircle2 className="w-3 h-3" />
                            )}
                            {req.status === 'REJECTED' && (
                              <XCircle className="w-3 h-3" />
                            )}
                            {req.status === 'PENDING' && (
                              <Clock className="w-3 h-3" />
                            )}
                            <span>{req.status}</span>
                          </span>
                        </td>
                        <td className="py-3 px-4 text-slate-300 max-w-xs">
                          {(() => {
                            const parsed = parsePaymentProofFromNote(req.note);
                            return (
                              <div className="space-y-1">
                                <div className="flex flex-wrap items-center gap-1.5">
                                  {parsed.methodLabel && (
                                    <span className="px-1.5 py-0.5 rounded bg-[#252a3a] border border-[#343b4f] text-[10px] font-mono font-bold text-[#3898ff]">
                                      {parsed.methodLabel}
                                    </span>
                                  )}
                                  {parsed.payoutBankName && (
                                    <span className="px-1.5 py-0.5 rounded bg-[#141722] border border-[#2e3446] text-[10px] font-mono text-slate-200">
                                      Bank: {parsed.payoutBankName}
                                      {parsed.payoutBranchName
                                        ? ` (${parsed.payoutBranchName})`
                                        : ''}
                                    </span>
                                  )}
                                  {parsed.payoutAccountId && (
                                    <span className="px-1.5 py-0.5 rounded bg-[#22ab68]/15 border border-[#22ab68]/30 text-[10px] font-mono font-bold text-[#22ab68]">
                                      {parsed.methodCode === 'BANK_TRANSFER'
                                        ? `A/C: ${parsed.payoutAccountId}`
                                        : `ID: ${parsed.payoutAccountId}`}
                                    </span>
                                  )}
                                  {parsed.payoutAccountName && (
                                    <span className="px-1.5 py-0.5 rounded bg-[#141722] border border-[#2e3446] text-[10px] font-semibold text-slate-300">
                                      Name: {parsed.payoutAccountName}
                                    </span>
                                  )}
                                  {parsed.transactionId && (
                                    <span className="px-1.5 py-0.5 rounded bg-[#22ab68]/15 border border-[#22ab68]/30 text-[10px] font-mono font-bold text-[#22ab68]">
                                      UTR: {parsed.transactionId}
                                    </span>
                                  )}
                                  {parsed.screenshotUrl && (
                                    <a
                                      href={parsed.screenshotUrl}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="px-1.5 py-0.5 rounded bg-[#141722] border border-[#2e3446] text-[10px] font-semibold text-sky-400 hover:underline inline-flex items-center gap-0.5"
                                    >
                                      <span>Receipt</span>
                                      <ExternalLink className="w-2.5 h-2.5" />
                                    </a>
                                  )}
                                </div>
                                {(parsed.userNote || (!parsed.methodLabel && req.note)) && (
                                  <div className="truncate text-xs text-slate-300" title={req.note || ''}>
                                    {parsed.userNote || req.note || '—'}
                                  </div>
                                )}
                              </div>
                            );
                          })()}
                        </td>
                        <td className="py-3 px-4 text-[#8c94ab] max-w-xs truncate">
                          {req.admin_note || '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Balance Ledger History Table with Pagination */}
        <section className="bg-[#1c202b] border border-[#2e3446] rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-[#262b38] flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <History className="w-4 h-4 text-[#3898ff]" />
              <h2 className="text-sm font-bold text-white">
                Balance Ledger History ({ledger.length})
              </h2>
            </div>

            <div className="flex items-center gap-2 text-xs font-mono text-[#8c94ab]">
              <span>
                Page {ledgerPage} of {totalLedgerPages}
              </span>
              <button
                type="button"
                disabled={ledgerPage <= 1}
                onClick={() => setLedgerPage((p) => Math.max(1, p - 1))}
                className="w-8 h-8 rounded-lg bg-[#252a3a] hover:bg-[#2e3446] disabled:opacity-40 flex items-center justify-center text-white cursor-pointer"
                aria-label="Previous Ledger Page"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                type="button"
                disabled={ledgerPage >= totalLedgerPages}
                onClick={() =>
                  setLedgerPage((p) => Math.min(totalLedgerPages, p + 1))
                }
                className="w-8 h-8 rounded-lg bg-[#252a3a] hover:bg-[#2e3446] disabled:opacity-40 flex items-center justify-center text-white cursor-pointer"
                aria-label="Next Ledger Page"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>

          {paginatedLedger.length === 0 ? (
            <div className="p-8 text-center text-xs text-[#8c94ab]">
              No balance ledger records found.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-[#262b38] text-[#7c849b] bg-[#171a23]/50">
                    <th className="py-3 px-4 font-semibold">Ledger Type</th>
                    <th className="py-3 px-4 font-semibold">
                      Change Amount ({currency})
                    </th>
                    <th className="py-3 px-4 font-semibold">
                      Balance After ({currency})
                    </th>
                    <th className="py-3 px-4 font-semibold">Note / Reference</th>
                    <th className="py-3 px-4 font-semibold text-right">
                      Timestamp
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#262b38]">
                  {paginatedLedger.map((entry) => {
                    const amt = Number(entry.delta ?? entry.amount ?? 0);
                    const balAfter = Number(entry.balance_after);
                    const isPositive = amt >= 0;
                    const displayType =
                      entry.entry_type || entry.type || 'ADJUSTMENT';
                    return (
                      <tr
                        key={entry.id}
                        className="hover:bg-[#232837]/50 transition-colors"
                      >
                        <td className="py-3 px-4 font-mono font-bold text-slate-200">
                          {displayType}
                        </td>
                        <td
                          className={`py-3 px-4 font-mono font-bold tabular-nums transition-opacity duration-150 ${
                            isFading ? 'opacity-30' : 'opacity-100'
                          } ${
                            isPositive ? 'text-[#22ab68]' : 'text-[#e34c3b]'
                          }`}
                        >
                          <div>
                            {formatMoney(amt, { showPlusSign: isPositive })}
                          </div>
                          {currency === 'NPR' && (
                            <div className="text-[10px] text-[#7c849b] font-normal">
                              Base: {isPositive ? '+' : '-'}$
                              {Math.abs(amt).toFixed(2)}
                            </div>
                          )}
                        </td>
                        <td
                          className={`py-3 px-4 font-mono font-bold text-white tabular-nums transition-opacity duration-150 ${
                            isFading ? 'opacity-30' : 'opacity-100'
                          }`}
                        >
                          <div>{formatMoney(balAfter)}</div>
                          {currency === 'NPR' && (
                            <div className="text-[10px] text-[#7c849b] font-normal">
                              Base: ${balAfter.toFixed(2)}
                            </div>
                          )}
                        </td>
                        <td className="py-3 px-4 text-[#8c94ab] max-w-xs truncate">
                          {entry.note
                            ? entry.note
                            : entry.trade_id
                              ? `Trade ${entry.trade_id.slice(0, 8)}...`
                              : 'Wallet / System'}
                        </td>
                        <td className="py-3 px-4 text-right font-mono text-[#7c849b] tabular-nums whitespace-nowrap">
                          {new Date(entry.created_at).toLocaleString()}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>

      <WalletActionModal
        isOpen={walletModalOpen}
        initialMode={walletModalMode}
        onClose={() => setWalletModalOpen(false)}
        userId={userId}
        userNumber={userNumber}
        userStatus={userStatus}
        balance={balance}
        pendingWithdrawalsTotal={pendingWithdrawalsTotal}
        pendingRequestsCount={pendingRequestsCount}
        onRequestCreated={(newReq) => {
          setRequests((prev) =>
            prev.some((r) => r.id === newReq.id) ? prev : [newReq, ...prev]
          );
          void loadWalletData();
        }}
        onToast={(t) => setToast(t)}
      />

      <ToastBanner toast={toast} onDismiss={() => setToast(null)} />
    </div>
  );
}
