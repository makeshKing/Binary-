'use client';

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { ArrowLeftRight } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { isSupabaseConfigured } from '@/lib/supabase/types';
import {
  CurrencyCode,
  DEFAULT_USDT_NPR_RATE,
  FormatMoneyOptions,
  ToBaseResult,
  formatMoney as formatMoneyHelper,
  toBase as toBaseHelper,
} from '@/lib/currency';

interface CurrencyContextValue {
  currency: CurrencyCode;
  rate: number;
  rateUpdatedAt: string | null;
  isRateMissing: boolean;
  isFading: boolean;
  isUpdatingPreference: boolean;
  setCurrency: (next: CurrencyCode) => Promise<void>;
  toggleCurrency: () => Promise<void>;
  formatMoney: (
    baseAmount: number | string | null | undefined,
    options?: FormatMoneyOptions
  ) => string;
  toBase: (inputAmount: number | string | null | undefined) => ToBaseResult;
  refreshRate: () => Promise<void>;
}

const CurrencyContext = createContext<CurrencyContextValue>({
  currency: 'USDT',
  rate: DEFAULT_USDT_NPR_RATE,
  rateUpdatedAt: null,
  isRateMissing: false,
  isFading: false,
  isUpdatingPreference: false,
  setCurrency: async () => {},
  toggleCurrency: async () => {},
  formatMoney: (baseAmount, options) =>
    formatMoneyHelper(baseAmount, 'USDT', DEFAULT_USDT_NPR_RATE, options),
  toBase: (inputAmount) =>
    toBaseHelper(inputAmount, 'USDT', DEFAULT_USDT_NPR_RATE),
  refreshRate: async () => {},
});

export function useCurrency(): CurrencyContextValue {
  return useContext(CurrencyContext);
}

export function CurrencyProvider({ children }: { children: React.ReactNode }) {
  // Initialize preferred currency from localStorage if available, defaulting to USDT
  const [currency, setCurrencyState] = useState<CurrencyCode>(() => {
    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem('preferred_currency');
        if (saved === 'USDT' || saved === 'NPR') return saved;
      } catch {
        // ignore localStorage access errors
      }
    }
    return 'USDT';
  });

  // Always fallback to default rate 1 USDT = Rs 134.50 immediately
  const [rate, setRate] = useState<number>(DEFAULT_USDT_NPR_RATE);
  const [rateUpdatedAt, setRateUpdatedAt] = useState<string | null>(null);
  const [isRateMissing, setIsRateMissing] = useState<boolean>(false);
  const [isFading, setIsFading] = useState<boolean>(false);
  const [isUpdatingPreference, setIsUpdatingPreference] =
    useState<boolean>(false);
  const [rateToast, setRateToast] = useState<string | null>(null);

  const fadeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initialLoadDoneRef = useRef<boolean>(false);

  const triggerNumberFade = useCallback(() => {
    if (fadeTimerRef.current) clearTimeout(fadeTimerRef.current);
    setIsFading(true);
    fadeTimerRef.current = setTimeout(() => {
      setIsFading(false);
    }, 180);
  }, []);

  const showRateUpdatedToast = useCallback((newRateNum: number) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setRateToast(`Rate updated: 1 USDT = Rs ${newRateNum.toFixed(2)}`);
    toastTimerRef.current = setTimeout(() => {
      setRateToast(null);
    }, 3800);
  }, []);

  const refreshRate = useCallback(async () => {
    if (!isSupabaseConfigured()) {
      setRate(DEFAULT_USDT_NPR_RATE);
      setIsRateMissing(false);
      return;
    }

    try {
      const supabase = createClient();
      const { data, error } = await supabase
        .from('exchange_rates')
        .select('id, rate, created_at')
        .eq('base', 'USDT')
        .eq('quote', 'NPR')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) {
        // Fallback RPC if direct table select fails before migration is applied
        try {
          const { data: rpcRate, error: rpcErr } =
            await supabase.rpc('get_current_rate');
          if (!rpcErr && rpcRate && Number(rpcRate) > 0) {
            setRate(Number(rpcRate));
            setRateUpdatedAt(new Date().toISOString());
            setIsRateMissing(false);
            return;
          }
        } catch {
          // rpc not available
        }
        // Fallback immediately to default rate 1 USDT = Rs 134.50
        setRate(DEFAULT_USDT_NPR_RATE);
        setIsRateMissing(false);
        return;
      }

      if (data && Number(data.rate) > 0) {
        setRate(Number(data.rate));
        setRateUpdatedAt(data.created_at);
        setIsRateMissing(false);
      } else {
        // Fallback to default rate 1 USDT = Rs 134.50
        setRate(DEFAULT_USDT_NPR_RATE);
        setIsRateMissing(false);
      }
    } catch {
      setRate(DEFAULT_USDT_NPR_RATE);
      setIsRateMissing(false);
    }
  }, []);

  // Load latest exchange rate + authenticated user's preferred_currency on mount & auth state changes
  useEffect(() => {
    // If client has preferred_currency stored in localStorage, ensure state reflects it
    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem('preferred_currency');
        if (saved === 'USDT' || saved === 'NPR') {
          setCurrencyState(saved);
        }
      } catch {
        // ignore
      }
    }

    refreshRate();

    if (!isSupabaseConfigured()) return;
    const supabase = createClient();
    let mounted = true;

    async function loadInitialCurrencyState() {
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        const userId = session?.user?.id;
        if (userId && mounted) {
          const { data: profile } = await supabase
            .from('profiles')
            .select('preferred_currency')
            .eq('id', userId)
            .maybeSingle();

          if (
            mounted &&
            profile &&
            (profile.preferred_currency === 'USDT' ||
              profile.preferred_currency === 'NPR')
          ) {
            setCurrencyState(profile.preferred_currency);
            if (typeof window !== 'undefined') {
              try {
                localStorage.setItem(
                  'preferred_currency',
                  profile.preferred_currency
                );
              } catch {
                // ignore
              }
            }
          }
        }
      } catch {
        // ignore
      }
      initialLoadDoneRef.current = true;
    }

    loadInitialCurrencyState();

    const {
      data: { subscription: authSub },
    } = supabase.auth.onAuthStateChange(async (_event, session) => {
      if (!mounted) return;
      if (session?.user?.id) {
        try {
          const { data: profile } = await supabase
            .from('profiles')
            .select('preferred_currency')
            .eq('id', session.user.id)
            .maybeSingle();
          if (
            mounted &&
            profile &&
            (profile.preferred_currency === 'USDT' ||
              profile.preferred_currency === 'NPR')
          ) {
            setCurrencyState(profile.preferred_currency);
            if (typeof window !== 'undefined') {
              try {
                localStorage.setItem(
                  'preferred_currency',
                  profile.preferred_currency
                );
              } catch {
                // ignore
              }
            }
          }
        } catch {
          // ignore
        }
      }
    });

    // Realtime subscription for exchange_rates INSERT
    const channel = supabase
      .channel('realtime-exchange-rates')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'exchange_rates',
        },
        (payload) => {
          if (!mounted) return;
          const newRow = payload.new as {
            rate?: number | string;
            created_at?: string;
          };
          const parsedRate = Number(newRow?.rate);
          if (Number.isFinite(parsedRate) && parsedRate > 0) {
            setRate(parsedRate);
            setRateUpdatedAt(newRow?.created_at || new Date().toISOString());
            setIsRateMissing(false);
            triggerNumberFade();
            showRateUpdatedToast(parsedRate);
          }
        }
      )
      .subscribe();

    return () => {
      mounted = false;
      authSub.unsubscribe();
      supabase.removeChannel(channel);
    };
  }, [refreshRate, showRateUpdatedToast, triggerNumberFade]);

  const setCurrency = useCallback(
    async (next: CurrencyCode) => {
      triggerNumberFade();
      setCurrencyState(next);

      // Save in browser local storage immediately
      if (typeof window !== 'undefined') {
        try {
          localStorage.setItem('preferred_currency', next);
        } catch (err) {
          console.warn('Failed to save preferred_currency to localStorage', err);
        }
      }

      // Show immediate confirmation toast
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
      const label = next === 'NPR' ? 'NPR (Rs)' : 'USDT ($)';
      setRateToast(`Currency changed to ${label}`);
      toastTimerRef.current = setTimeout(() => {
        setRateToast(null);
      }, 2500);

      if (!isSupabaseConfigured()) return;

      setIsUpdatingPreference(true);
      try {
        const supabase = createClient();
        const {
          data: { session },
        } = await supabase.auth.getSession();

        if (session?.user?.id) {
          // Sync to Supabase user profile
          await supabase
            .from('profiles')
            .update({ preferred_currency: next })
            .eq('id', session.user.id);

          try {
            await supabase.rpc('set_preferred_currency', { p_code: next });
          } catch {
            // ignore RPC failure if function not defined
          }
        }
      } catch {
        // Keep optimistic UI currency even if transient network error occurs
      } finally {
        setIsUpdatingPreference(false);
      }
    },
    [triggerNumberFade]
  );

  const toggleCurrency = useCallback(async () => {
    const next: CurrencyCode = currency === 'USDT' ? 'NPR' : 'USDT';
    await setCurrency(next);
  }, [currency, setCurrency]);

  const effectiveCurrency: CurrencyCode = currency;

  const formatMoney = useCallback(
    (
      baseAmount: number | string | null | undefined,
      options?: FormatMoneyOptions
    ) => {
      return formatMoneyHelper(baseAmount, effectiveCurrency, rate, options);
    },
    [effectiveCurrency, rate]
  );

  const toBase = useCallback(
    (inputAmount: number | string | null | undefined) => {
      return toBaseHelper(inputAmount, effectiveCurrency, rate);
    },
    [effectiveCurrency, rate]
  );

  const value = useMemo<CurrencyContextValue>(
    () => ({
      currency: effectiveCurrency,
      rate,
      rateUpdatedAt,
      isRateMissing,
      isFading,
      isUpdatingPreference,
      setCurrency,
      toggleCurrency,
      formatMoney,
      toBase,
      refreshRate,
    }),
    [
      effectiveCurrency,
      rate,
      rateUpdatedAt,
      isRateMissing,
      isFading,
      isUpdatingPreference,
      setCurrency,
      toggleCurrency,
      formatMoney,
      toBase,
      refreshRate,
    ]
  );

  return (
    <CurrencyContext.Provider value={value}>
      {rateToast && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-4 right-4 z-[110] px-3.5 py-2.5 rounded-xl bg-[#132a20]/95 border border-[#22ab68] text-emerald-100 text-xs font-semibold shadow-2xl flex items-center gap-2 transition-all animate-in fade-in slide-in-from-bottom-2 duration-200"
        >
          <ArrowLeftRight className="w-3.5 h-3.5 text-[#22ab68]" />
          <span className="font-mono tabular-nums">{rateToast}</span>
        </div>
      )}

      {children}
    </CurrencyContext.Provider>
  );
}

/**
 * Reusable compact Currency Switcher button (swap/arrows icon + bold "USDT" or "NPR" label)
 * with tooltip "Switch currency to NPR (Rs)" / "Switch currency to USDT ($)".
 */
export function CurrencyToggleButton({
  className = '',
}: {
  className?: string;
}) {
  const { currency, toggleCurrency, rate } = useCurrency();

  return (
    <button
      type="button"
      onClick={() => {
        toggleCurrency();
      }}
      title={`Switch currency to ${currency === 'USDT' ? 'NPR (Rs)' : 'USDT ($)'}`}
      aria-label="Switch currency"
      className={`h-8 sm:h-9 px-2 sm:px-2.5 rounded-lg bg-[#252a3a] border border-[#31384d] hover:bg-[#2b3144] hover:border-[#3898ff]/70 active:scale-95 text-slate-100 flex items-center gap-1 sm:gap-1.5 transition-all cursor-pointer select-none shrink-0 ${className}`}
    >
      <ArrowLeftRight className="w-3 sm:w-3.5 h-3 sm:h-3.5 text-[#3898ff] shrink-0" />
      <span className="text-[10px] sm:text-[11px] font-extrabold font-mono tracking-wider uppercase text-white">
        {currency}
      </span>
      {currency === 'NPR' && rate && (
        <span className="hidden xl:inline text-[10px] font-mono text-[#8c94ab] tabular-nums">
          ({rate.toFixed(2)})
        </span>
      )}
    </button>
  );
}
