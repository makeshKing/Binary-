'use client';

import React, { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  Bell,
  Wallet,
  CheckCheck,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react';
import {
  UserNotificationRow,
  resolveUserNumber,
} from '@/lib/supabase/types';
import {
  CurrencyToggleButton,
  useCurrency,
} from '@/components/CurrencyProvider';

interface BalanceBadgeProps {
  balance: number;
  userId?: string | null;
  userNumber?: number | null;
  notifications?: UserNotificationRow[];
  onMarkNotificationsRead?: () => void;
  onOpenDepositModal?: () => void;
  onOpenWithdrawModal?: () => void;
  onBalanceUpdated?: (newBalance: number) => void;
  onLogout?: () => void;
  onToast?: (toast: {
    type: 'success' | 'error' | 'info';
    message: string;
  }) => void;
}

export function BalanceBadge({
  balance,
  userId,
  userNumber,
  notifications = [],
  onMarkNotificationsRead,
  onOpenDepositModal,
}: BalanceBadgeProps) {
  const {
    isFading,
    formatMoney,
  } = useCurrency();
  const prevBalanceRef = useRef<number>(balance);
  const [flashState, setFlashState] = useState<'none' | 'up' | 'down'>('none');
  const [notifOpen, setNotifOpen] = useState<boolean>(false);

  const displayUserNumber = resolveUserNumber(userNumber, userId);
  const unreadCount = notifications.filter((n) => !n.is_read).length;

  useEffect(() => {
    const prev = prevBalanceRef.current;
    if (balance > prev) {
      setFlashState('up');
    } else if (balance < prev) {
      setFlashState('down');
    }
    prevBalanceRef.current = balance;

    const timer = setTimeout(() => setFlashState('none'), 900);
    return () => clearTimeout(timer);
  }, [balance]);

  return (
    <div className="flex items-center justify-between lg:justify-end w-full lg:w-auto gap-1 sm:gap-2 relative">
      <div className="flex items-center gap-1 sm:gap-1.5 shrink-0">
        {/* LIVE Balance Badge */}
        <div className="relative">
          <button
            type="button"
            onClick={() => {
              setNotifOpen(false);
            }}
            className={`h-8 sm:h-9 px-2 sm:px-2.5 rounded-lg border flex items-center gap-1 sm:gap-1.5 transition-all duration-300 cursor-pointer shrink-0 ${
              flashState === 'up'
                ? 'bg-[#22ab68]/20 border-[#22ab68] scale-[1.02]'
                : flashState === 'down'
                  ? 'bg-[#e34c3b]/20 border-[#e34c3b] scale-[0.99]'
                  : 'bg-[#252a3a] border-[#31384d] hover:bg-[#2b3144]'
            }`}
          >
            <Wallet className="w-3.5 h-3.5 text-[#22ab68] shrink-0" />
            <span className="text-[10px] sm:text-[11px] font-extrabold text-[#22ab68] uppercase tracking-wide">
              LIVE
            </span>
            <span
              className={`text-[11px] sm:text-xs font-bold font-mono tabular-nums transition-all duration-150 ${
                isFading ? 'opacity-30 scale-[0.98]' : 'opacity-100 scale-100'
              } ${
                flashState === 'up'
                  ? 'text-[#22ab68]'
                  : flashState === 'down'
                    ? 'text-[#e34c3b]'
                    : 'text-white'
              }`}
            >
              {formatMoney(balance)}
            </span>
          </button>
        </div>

        {/* Currency Switcher Toggle Icon right next to Balance Badge */}
        <CurrencyToggleButton />

        {/* Bell Notification Dropdown */}
        <div className="relative">
          <button
            type="button"
            onClick={() => {
              setNotifOpen((prev) => !prev);
            }}
            className="h-8 sm:h-9 px-2 sm:px-2.5 rounded-lg bg-[#252a3a] border border-[#31384d] hover:bg-[#2b3144] flex items-center gap-1 cursor-pointer shrink-0"
            title="Wallet & Account Notifications"
          >
            <Bell className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-slate-200" />
            {unreadCount > 0 && (
              <span className="px-1.5 py-0.2 rounded-full bg-[#e34c3b] text-white text-[10px] font-bold leading-tight tabular-nums">
                {unreadCount}
              </span>
            )}
          </button>

          {notifOpen && (
            <div className="absolute right-0 top-11 w-80 bg-[#1c202e] border border-[#343b4f] rounded-xl shadow-2xl p-3.5 z-50 space-y-2.5">
              <div className="flex items-center justify-between pb-2 border-b border-[#2a3042]">
                <span className="text-xs font-bold text-white">
                  Notifications ({unreadCount} unread)
                </span>
                {unreadCount > 0 && onMarkNotificationsRead && (
                  <button
                    type="button"
                    onClick={() => onMarkNotificationsRead()}
                    className="text-[11px] font-semibold text-[#3898ff] hover:underline flex items-center gap-1 cursor-pointer"
                  >
                    <CheckCheck className="w-3.5 h-3.5" />
                    <span>Mark read</span>
                  </button>
                )}
              </div>

              <div className="max-h-64 overflow-y-auto space-y-2 pr-1">
                {notifications.length === 0 ? (
                  <div className="py-6 text-center text-xs text-[#8c94ab]">
                    No notifications yet. You will be notified here when a deposit or withdrawal request is reviewed.
                  </div>
                ) : (
                  notifications.slice(0, 12).map((n) => (
                    <div
                      key={n.id}
                      className={`p-2.5 rounded-lg border text-xs ${
                        n.is_read
                          ? 'bg-[#141722]/60 border-[#262b38] text-slate-300'
                          : 'bg-[#1f263a] border-[#3898ff]/40 text-white'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-bold text-[11px]">{n.title}</span>
                        <span className="text-[10px] font-mono text-[#7c849b]">
                          {new Date(n.created_at).toLocaleTimeString([], {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </span>
                      </div>
                      <p className="text-[11px] text-[#9aa3ba] mt-1 leading-relaxed">
                        {n.message}
                      </p>
                    </div>
                  ))
                )}
              </div>

              <div className="pt-2 border-t border-[#2a3042] flex items-center justify-between text-[11px]">
                <span className="text-[#7c849b] font-mono">
                  User ID: {displayUserNumber || '—'}
                </span>
                <Link
                  href="/wallet"
                  prefetch={false}
                  onClick={() => setNotifOpen(false)}
                  className="font-bold text-[#3898ff] hover:underline"
                >
                  View Wallet Requests →
                </Link>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Green 'Deposit' Button */}
      {onOpenDepositModal ? (
        <button
          type="button"
          onClick={onOpenDepositModal}
          title="Open Deposit Modal"
          className="h-8 sm:h-9 px-3 sm:px-4 rounded-lg bg-[#22ab68] hover:bg-[#1e995d] active:scale-95 text-white text-xs sm:text-sm font-extrabold flex items-center justify-center gap-1.5 transition-all shrink-0 shadow cursor-pointer ml-auto sm:ml-0"
        >
          <span>Deposit</span>
        </button>
      ) : (
        <Link
          href="/wallet"
          prefetch={false}
          title="Open Account Wallet"
          className="h-8 sm:h-9 px-3 sm:px-4 rounded-lg bg-[#22ab68] hover:bg-[#1e995d] active:scale-95 text-white text-xs sm:text-sm font-extrabold flex items-center justify-center gap-1.5 transition-all shrink-0 shadow ml-auto sm:ml-0"
        >
          <span>Deposit</span>
        </Link>
      )}
    </div>
  );
}

export function ToastBanner({
  toast,
  onDismiss,
}: {
  toast: { type: 'success' | 'error' | 'info'; message: string } | null;
  onDismiss: () => void;
}) {
  if (!toast) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className={`fixed top-16 left-3 right-3 sm:left-auto sm:right-5 z-[100] sm:max-w-sm px-4 py-3 rounded-xl border shadow-2xl flex items-center gap-2.5 text-xs font-semibold transition-all ${
        toast.type === 'success'
          ? 'bg-[#132a20]/95 backdrop-blur-md border-[#22ab68] text-emerald-100'
          : toast.type === 'error'
            ? 'bg-[#2c1619]/95 backdrop-blur-md border-[#e34c3b] text-red-100'
            : 'bg-[#1c2436]/95 backdrop-blur-md border-[#1d8cf8] text-blue-100'
      }`}
    >
      {toast.type === 'success' ? (
        <CheckCircle2 className="w-4 h-4 text-[#22ab68] shrink-0" />
      ) : (
        <AlertCircle className="w-4 h-4 text-[#e34c3b] shrink-0" />
      )}
      <span className="flex-1">{toast.message}</span>
      <button
        type="button"
        onClick={onDismiss}
        className="w-7 h-7 flex items-center justify-center text-slate-400 hover:text-white ml-1 cursor-pointer"
      >
        ✕
      </button>
    </div>
  );
}
