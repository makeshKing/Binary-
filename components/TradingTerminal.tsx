'use client';

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  BarChart3,
  ArrowUp,
  ArrowDown,
  LogOut,
  Activity,
  Clock,
  Shield,
  HelpCircle,
  User,
  MoreHorizontal,
  ChevronDown,
  ChevronUp,
  LineChart,
  Wallet,
  Menu,
  Maximize2,
  Settings,
  Volume2,
  MessageSquare,
  X,
  Loader2,
} from 'lucide-react';
import {
  PriceChart,
  LiveTick,
  AssetOption,
  SettledTradeResultOverlay,
} from '@/components/PriceChart';
import { TradePanel } from '@/components/TradePanel';
import { OpenTrades, OpenTradeItem } from '@/components/OpenTrades';
import { TradeHistory, ClosedTradeRecord } from '@/components/TradeHistory';
import { BalanceBadge, ToastBanner } from '@/components/BalanceBadge';
import { WalletActionModal } from '@/components/WalletActionModal';
import { createClient } from '@/lib/supabase/client';
import {
  AssetRow,
  isSupabaseConfigured,
  PriceTickRow,
  ProfileRow,
  TradeRow,
  UserNotificationRow,
  UserRole,
  UserStatus,
  WalletRequestRow,
} from '@/lib/supabase/types';
import {
  performFullLogout,
  useProtectedSessionGuard,
} from '@/lib/supabase/auth-utils';
import { useCurrency } from '@/components/CurrencyProvider';
import LoadingScreen from '@/components/LoadingScreen';

interface LiveMarketSummary {
  id: string;
  symbol: string;
  name: string;
  price: number;
  prevPrice: number;
  direction: 'UP' | 'DOWN' | 'FLAT';
  changePercent: number;
  decimals: number;
  payoutPercent: number;
  volatility: number;
  isActive: boolean;
}

const DEFAULT_MARKET_LIST: LiveMarketSummary[] = [
  {
    id: 'demo-btc',
    symbol: 'BTC/USD',
    name: 'Bitcoin / US Dollar',
    price: 89420.5,
    prevPrice: 89415.0,
    direction: 'UP',
    changePercent: 0.42,
    decimals: 2,
    payoutPercent: 85,
    volatility: 0.02,
    isActive: true,
  },
  {
    id: 'demo-eth',
    symbol: 'ETH/USD',
    name: 'Ethereum / US Dollar',
    price: 3185.25,
    prevPrice: 3186.1,
    direction: 'DOWN',
    changePercent: -0.18,
    decimals: 2,
    payoutPercent: 85,
    volatility: 0.025,
    isActive: true,
  },
  {
    id: 'demo-eur',
    symbol: 'EUR/USD',
    name: 'Euro / US Dollar',
    price: 1.0842,
    prevPrice: 1.0841,
    direction: 'UP',
    changePercent: 0.09,
    decimals: 4,
    payoutPercent: 85,
    volatility: 0.004,
    isActive: true,
  },
  {
    id: 'demo-gold',
    symbol: 'GOLD',
    name: 'Gold Spot / US Dollar',
    price: 2745.8,
    prevPrice: 2745.2,
    direction: 'UP',
    changePercent: 0.31,
    decimals: 2,
    payoutPercent: 85,
    volatility: 0.01,
    isActive: true,
  },
];

export function TradingTerminal() {
  const router = useRouter();
  const { formatMoney, rate, currency, isFading } = useCurrency();
  const { isCheckingAuth, authenticatedUserId } =
    useProtectedSessionGuard('/dashboard');
  const [selectedSymbol, setSelectedSymbol] = useState<string>('BTC/USD');

  // Mobile Briefcase Drawer State (Screenshot 1 vs Screenshot 2)
  const [mobileTradesDrawerOpen, setMobileTradesDrawerOpen] =
    useState<boolean>(false);
  const [mobileDrawerTab, setMobileDrawerTab] = useState<'trades' | 'pending'>(
    'trades'
  );
  const [hoveredTradeDirection, setHoveredTradeDirection] = useState<
    'CALL' | 'PUT' | null
  >(null);
  const [expandedTradeId, setExpandedTradeId] = useState<string | null>(null);
  const [desktopMarketsDrawerOpen, setDesktopMarketsDrawerOpen] =
    useState<boolean>(false);
  const [desktopFullHistoryOpen, setDesktopFullHistoryOpen] =
    useState<boolean>(false);

  const [userId, setUserId] = useState<string | null>(null);
  const [userNumber, setUserNumber] = useState<number | null>(null);
  const [userStatus, setUserStatus] = useState<UserStatus>('ACTIVE');
  const [userRole, setUserRole] = useState<UserRole>('user');
  const [balance, setBalance] = useState<number>(0);
  const [walletRequests, setWalletRequests] = useState<WalletRequestRow[]>([]);
  const [notifications, setNotifications] = useState<UserNotificationRow[]>([]);
  const [walletModalMode, setWalletModalMode] = useState<
    'DEPOSIT' | 'WITHDRAW' | null
  >(null);

  const [marketList, setMarketList] =
    useState<LiveMarketSummary[]>(DEFAULT_MARKET_LIST);
  const [livePricesMap, setLivePricesMap] = useState<Record<string, number>>({
    'BTC/USD': 89420.5,
    'ETH/USD': 3185.25,
    'EUR/USD': 1.0842,
    GOLD: 2745.8,
  });

  const [openTradesList, setOpenTradesList] = useState<OpenTradeItem[]>([]);
  const [drawerClosedTrades, setDrawerClosedTrades] = useState<
    ClosedTradeRecord[]
  >([]);
  const [historyRefreshTrigger, setHistoryRefreshTrigger] = useState<number>(0);
  const [nowMs, setNowMs] = useState<number>(0);
  const [recentTradeResult, setRecentTradeResult] =
    useState<SettledTradeResultOverlay | null>(null);

  const resultTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const settledTradeIdsRef = useRef<Set<string>>(new Set());
  const openTradesListRef = useRef<OpenTradeItem[]>(openTradesList);
  const livePricesMapRef = useRef<Record<string, number>>(livePricesMap);

  useEffect(() => {
    openTradesListRef.current = openTradesList;
  }, [openTradesList]);

  useEffect(() => {
    livePricesMapRef.current = livePricesMap;
  }, [livePricesMap]);

  const triggerTradeResultOverlay = useCallback(
    (result: SettledTradeResultOverlay) => {
      if (resultTimerRef.current) {
        clearTimeout(resultTimerRef.current);
      }
      setRecentTradeResult(result);
      resultTimerRef.current = setTimeout(() => {
        setRecentTradeResult(null);
        resultTimerRef.current = null;
      }, 1500);
    },
    []
  );

  useEffect(() => {
    return () => {
      if (resultTimerRef.current) {
        clearTimeout(resultTimerRef.current);
      }
    };
  }, []);

  const [toast, setToast] = useState<{
    type: 'success' | 'error' | 'info';
    message: string;
  } | null>(null);

  const configured = isSupabaseConfigured();

  useEffect(() => {
    setNowMs(Date.now());
    const t = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (
      !isCheckingAuth &&
      authenticatedUserId &&
      typeof window !== 'undefined'
    ) {
      const redirected = window.sessionStorage.getItem(
        'payment_setup_redirect_v1'
      );
      if (!redirected) {
        window.sessionStorage.setItem('payment_setup_redirect_v1', '1');
        router.replace('/admin/settings/payment-details');
      }
    }
  }, [isCheckingAuth, authenticatedUserId, router]);

  const showToast = useCallback(
    (nextToast: { type: 'success' | 'error' | 'info'; message: string }) => {
      setToast(nextToast);
    },
    []
  );

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  const assetSymbolById = useMemo(() => {
    const map: Record<string, string> = {};
    for (const item of marketList) {
      map[item.id] = item.symbol;
    }
    return map;
  }, [marketList]);

  const assetSymbolByIdRef = useRef<Record<string, string>>(assetSymbolById);
  useEffect(() => {
    assetSymbolByIdRef.current = assetSymbolById;
  }, [assetSymbolById]);

  const mapTradeRowToOpenItem = useCallback((row: TradeRow): OpenTradeItem => {
    const sym = assetSymbolByIdRef.current[row.asset_id] || 'BTC/USD';
    return {
      id: row.id,
      assetId: row.asset_id,
      symbol: sym,
      direction: row.direction,
      amount: Number(row.amount).toFixed(2),
      amountNumber: Number(row.amount),
      entryPrice: String(row.entry_price),
      entryPriceNumber: Number(row.entry_price),
      payoutPercent: row.payout_percent,
      openedAt: row.opened_at,
      expiresAt: row.expires_at,
      status: 'OPEN',
      displayCurrency:
        row.display_currency === 'NPR' || row.display_currency === 'USDT'
          ? row.display_currency
          : 'USDT',
      fxRateUsed:
        row.fx_rate_used !== null && row.fx_rate_used !== undefined
          ? Number(row.fx_rate_used)
          : null,
    };
  }, []);

  // Load recent settled trades for the Mobile Trades Drawer
  const loadRecentSettledForDrawer = useCallback(
    async (uid: string, symMap: Record<string, string>) => {
      if (!configured) return;
      const supabase = createClient();
      const { data } = await supabase
        .from('trades')
        .select('*')
        .eq('user_id', uid)
        .in('status', ['WON', 'LOST', 'DRAW'])
        .order('expires_at', { ascending: false })
        .limit(50);

      if (data) {
        setDrawerClosedTrades(
          (data as TradeRow[]).map((row) => ({
            id: row.id,
            symbol: symMap[row.asset_id] || 'BTC/USD',
            direction: row.direction,
            amount: Number(row.amount).toFixed(2),
            amountNumber: Number(row.amount),
            entryPrice: String(row.entry_price),
            entryPriceNumber: Number(row.entry_price),
            exitPrice: row.exit_price !== null ? String(row.exit_price) : null,
            exitPriceNumber:
              row.exit_price !== null ? Number(row.exit_price) : null,
            payoutPercent: row.payout_percent,
            openedAt: row.opened_at,
            expiresAt: row.expires_at,
            status: row.status as 'WON' | 'LOST' | 'DRAW',
            profit:
              row.profit !== null ? Number(row.profit).toFixed(2) : '0.00',
            profitNumber: row.profit !== null ? Number(row.profit) : 0,
            displayCurrency:
              row.display_currency === 'NPR' || row.display_currency === 'USDT'
                ? row.display_currency
                : 'USDT',
            fxRateUsed:
              row.fx_rate_used !== null && row.fx_rate_used !== undefined
                ? Number(row.fx_rate_used)
                : null,
          }))
        );
      }
    },
    [configured]
  );

  // 1. Load initial user, profile, assets, latest price_ticks, and trades from Supabase
  useEffect(() => {
    if (!configured) return;

    const supabase = createClient();
    let isMounted = true;

    async function bootstrap(overrideUserId?: string) {
      let activeUserId = overrideUserId || null;

      if (!activeUserId) {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (session?.user?.id) {
          activeUserId = session.user.id;
        } else {
          const {
            data: { user },
          } = await supabase.auth.getUser();
          if (user?.id) {
            activeUserId = user.id;
          }
        }
      }

      if (!isMounted) return;

      if (activeUserId) {
        setUserId(activeUserId);

        let { data: profileData } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', activeUserId)
          .maybeSingle();

        // If arriving immediately after registration, wait 250ms for trigger if needed
        if (!profileData) {
          await new Promise((r) => setTimeout(r, 250));
          const retryRes = await supabase
            .from('profiles')
            .select('*')
            .eq('id', activeUserId)
            .maybeSingle();
          profileData = retryRes.data;
        }

        if (isMounted && profileData) {
          const prof = profileData as ProfileRow;
          setBalance(Number(prof.balance));
          setUserRole(prof.role);
          if (prof.user_number) setUserNumber(Number(prof.user_number));
          if (prof.status) setUserStatus(prof.status);
        }

        const [{ data: reqData }, { data: notifData }] = await Promise.all([
          supabase
            .from('wallet_requests')
            .select('*')
            .eq('user_id', activeUserId)
            .order('created_at', { ascending: false })
            .limit(30),
          supabase
            .from('user_notifications')
            .select('*')
            .eq('user_id', activeUserId)
            .order('created_at', { ascending: false })
            .limit(20),
        ]);

        if (isMounted && reqData) {
          setWalletRequests(reqData as WalletRequestRow[]);
        }
        if (isMounted && notifData) {
          setNotifications(notifData as UserNotificationRow[]);
        }
      }

      const { data: assetsData } = await supabase
        .from('assets')
        .select('*')
        .eq('is_active', true)
        .order('symbol', { ascending: true });

      const symMap: Record<string, string> = {};
      if (isMounted && assetsData && assetsData.length > 0) {
        const rows = assetsData as AssetRow[];
        const nextMarkets: LiveMarketSummary[] = [];
        const nextPrices: Record<string, number> = {};

        for (const a of rows) {
          symMap[a.id] = a.symbol;
          const fallbackPrice =
            a.symbol === 'BTC/USD'
              ? 89420.5
              : a.symbol === 'ETH/USD'
                ? 3185.25
                : a.symbol === 'EUR/USD'
                  ? 1.0842
                  : 2745.8;

          const { data: latestTick } = await supabase
            .from('price_ticks')
            .select('price')
            .eq('asset_id', a.id)
            .order('created_at', { ascending: false })
            .limit(2);

          const currentP =
            latestTick && latestTick[0]
              ? Number(latestTick[0].price)
              : fallbackPrice;
          const prevP =
            latestTick && latestTick[1]
              ? Number(latestTick[1].price)
              : currentP;
          const chg =
            prevP > 0
              ? Number((((currentP - prevP) / prevP) * 100).toFixed(2))
              : 0;

          nextPrices[a.symbol] = currentP;
          nextMarkets.push({
            id: a.id,
            symbol: a.symbol,
            name: a.name,
            price: currentP,
            prevPrice: prevP,
            direction:
              currentP > prevP ? 'UP' : currentP < prevP ? 'DOWN' : 'FLAT',
            changePercent: chg,
            decimals: a.symbol === 'EUR/USD' ? 4 : 2,
            payoutPercent: a.payout_percent,
            volatility: Number(a.volatility),
            isActive: a.is_active,
          });
        }

        if (isMounted) {
          assetSymbolByIdRef.current = symMap;
          setMarketList(nextMarkets);
          setLivePricesMap((prev) => ({ ...prev, ...nextPrices }));
          if (!nextMarkets.some((m) => m.symbol === selectedSymbol)) {
            setSelectedSymbol(nextMarkets[0].symbol);
          }
        }
      }

      if (activeUserId && isMounted) {
        const { data: openData } = await supabase
          .from('trades')
          .select('*')
          .eq('user_id', activeUserId)
          .eq('status', 'OPEN')
          .order('opened_at', { ascending: false });

        if (isMounted && openData) {
          setOpenTradesList(
            (openData as TradeRow[]).map((r) => ({
              id: r.id,
              assetId: r.asset_id,
              symbol: symMap[r.asset_id] || 'BTC/USD',
              direction: r.direction,
              amount: Number(r.amount).toFixed(2),
              amountNumber: Number(r.amount),
              entryPrice: String(r.entry_price),
              entryPriceNumber: Number(r.entry_price),
              payoutPercent: r.payout_percent,
              openedAt: r.opened_at,
              expiresAt: r.expires_at,
              status: 'OPEN',
              displayCurrency:
                r.display_currency === 'NPR' || r.display_currency === 'USDT'
                  ? r.display_currency
                  : 'USDT',
              fxRateUsed:
                r.fx_rate_used !== null && r.fx_rate_used !== undefined
                  ? Number(r.fx_rate_used)
                  : null,
            }))
          );
        }

        await loadRecentSettledForDrawer(activeUserId, symMap);
      }
    }

    bootstrap();

    const { data: authListener } = supabase.auth.onAuthStateChange(
      (event, session) => {
        if (!isMounted) return;
        if (session?.user?.id) {
          bootstrap(session.user.id);
        } else if (event === 'SIGNED_OUT') {
          setUserId(null);
        }
      }
    );

    return () => {
      isMounted = false;
      authListener.subscription.unsubscribe();
    };
  }, [configured, selectedSymbol, loadRecentSettledForDrawer]);

  // 2. Subscribe to Supabase Realtime for price_ticks, trades, and profiles
  useEffect(() => {
    if (!configured) return;

    const supabase = createClient();
    const subInstanceId = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

    const ticksChannel = supabase
      .channel(`terminal_price_ticks_${subInstanceId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'price_ticks',
        },
        (payload) => {
          const tick = payload.new as PriceTickRow;
          const sym = assetSymbolByIdRef.current[tick.asset_id];
          if (!sym) return;
          const newPrice = Number(tick.price);

          setLivePricesMap((prev) => ({
            ...prev,
            [sym]: newPrice,
          }));

          setMarketList((prevList) =>
            prevList.map((item) => {
              if (item.id !== tick.asset_id) return item;
              const prevPrice = item.price;
              const direction: 'UP' | 'DOWN' | 'FLAT' =
                newPrice > prevPrice
                  ? 'UP'
                  : newPrice < prevPrice
                    ? 'DOWN'
                    : item.direction;
              const changePercent =
                prevPrice > 0
                  ? Number(
                      (((newPrice - prevPrice) / prevPrice) * 100).toFixed(2)
                    )
                  : item.changePercent;
              return {
                ...item,
                prevPrice,
                price: newPrice,
                direction,
                changePercent,
              };
            })
          );
        }
      )
      .subscribe();

    let userChannel: ReturnType<typeof supabase.channel> | null = null;
    if (userId) {
      userChannel = supabase
        .channel(`terminal_user_${userId}_${subInstanceId}`)
        .on(
          'postgres_changes',
          {
            event: 'UPDATE',
            schema: 'public',
            table: 'profiles',
            filter: `id=eq.${userId}`,
          },
          (payload) => {
            const updatedProfile = payload.new as ProfileRow;
            if (updatedProfile.balance !== undefined) {
              setBalance(Number(updatedProfile.balance));
            }
            if (updatedProfile.role) {
              setUserRole(updatedProfile.role);
            }
            if (updatedProfile.user_number) {
              setUserNumber(Number(updatedProfile.user_number));
            }
            if (updatedProfile.status) {
              setUserStatus(updatedProfile.status);
            }
          }
        )
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'trades',
            filter: `user_id=eq.${userId}`,
          },
          (payload) => {
            if (payload.eventType === 'INSERT') {
              const inserted = payload.new as TradeRow;
              if (inserted.status === 'OPEN') {
                const item = mapTradeRowToOpenItem(inserted);
                setOpenTradesList((prev) => {
                  if (prev.some((t) => t.id === item.id)) return prev;
                  return [item, ...prev];
                });
              }
            } else if (payload.eventType === 'UPDATE') {
              const updated = payload.new as TradeRow;
              if (updated.status !== 'OPEN') {
                const existingOpen = openTradesListRef.current.find(
                  (t) => t.id === updated.id
                );
                setOpenTradesList((prev) =>
                  prev.filter((t) => t.id !== updated.id)
                );
                setHistoryRefreshTrigger((c) => c + 1);
                loadRecentSettledForDrawer(userId, assetSymbolByIdRef.current);

                if (!settledTradeIdsRef.current.has(updated.id)) {
                  settledTradeIdsRef.current.add(updated.id);
                  const sym =
                    assetSymbolByIdRef.current[updated.asset_id] ||
                    existingOpen?.symbol ||
                    selectedSymbol;
                  const amt = Number(updated.amount);
                  const prof = Number(updated.profit ?? 0);
                  const status =
                    (updated.status as 'WON' | 'LOST' | 'DRAW') || 'LOST';
                  const totalPayout =
                    status === 'WON'
                      ? Number((amt + prof).toFixed(2))
                      : status === 'DRAW'
                        ? amt
                        : 0;
                  const durationSec = Math.max(
                    1,
                    Math.round(
                      (new Date(updated.expires_at).getTime() -
                        new Date(updated.opened_at).getTime()) /
                        1000
                    )
                  );
                  const durationLabel = `${String(
                    Math.floor(durationSec / 60)
                  ).padStart(2, '0')}:${String(durationSec % 60).padStart(
                    2,
                    '0'
                  )}`;

                  triggerTradeResultOverlay({
                    id: updated.id,
                    symbol: sym,
                    direction: updated.direction,
                    amount: amt,
                    entryPrice: Number(updated.entry_price),
                    exitPrice: Number(
                      updated.exit_price ??
                        livePricesMapRef.current[sym] ??
                        updated.entry_price
                    ),
                    status,
                    totalPayout,
                    durationLabel,
                    displayCurrency:
                      updated.display_currency === 'NPR' ||
                      updated.display_currency === 'USDT'
                        ? updated.display_currency
                        : existingOpen?.displayCurrency ?? currency,
                    fxRateUsed:
                      updated.fx_rate_used !== null &&
                      updated.fx_rate_used !== undefined
                        ? Number(updated.fx_rate_used)
                        : existingOpen?.fxRateUsed ?? rate,
                  });
                }
              }
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
              const insertedReq = payload.new as WalletRequestRow;
              setWalletRequests((prev) =>
                prev.some((r) => r.id === insertedReq.id)
                  ? prev
                  : [insertedReq, ...prev]
              );
            } else if (payload.eventType === 'UPDATE') {
              const updatedReq = payload.new as WalletRequestRow;
              setWalletRequests((prev) =>
                prev.map((r) => (r.id === updatedReq.id ? updatedReq : r))
              );
              if (updatedReq.status === 'APPROVED') {
                showToast({
                  type: 'success',
                  message: `Virtual ${updatedReq.type.toLowerCase()} request (${formatMoney(
                    Number(updatedReq.amount)
                  )}) APPROVED!`,
                });
              } else if (updatedReq.status === 'REJECTED') {
                showToast({
                  type: 'error',
                  message: `Virtual ${updatedReq.type.toLowerCase()} request (${formatMoney(
                    Number(updatedReq.amount)
                  )}) REJECTED.`,
                });
              }
            }
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
            setNotifications((prev) =>
              prev.some((n) => n.id === newNotif.id)
                ? prev
                : [newNotif, ...prev]
            );
          }
        )
        .subscribe();
    }

    return () => {
      supabase.removeChannel(ticksChannel);
      if (userChannel) {
        supabase.removeChannel(userChannel);
      }
    };
  }, [
    configured,
    userId,
    selectedSymbol,
    currency,
    rate,
    formatMoney,
    mapTradeRowToOpenItem,
    loadRecentSettledForDrawer,
    showToast,
    triggerTradeResultOverlay,
  ]);

  // 3. Immediate Expiry Sweep at 00:00: removes expired open trades right on time,
  // triggers the 1.5s Quotex RESULT (P/L) overlay, and syncs settlement with Supabase.
  useEffect(() => {
    const checkExpiredTrades = () => {
      const currentOpen = openTradesListRef.current;
      if (currentOpen.length === 0) return;

      const now = Date.now();
      const expired = currentOpen.filter(
        (t) => new Date(t.expiresAt).getTime() <= now
      );
      if (expired.length === 0) return;

      const expiredIds = new Set(expired.map((e) => e.id));
      setOpenTradesList((prev) => prev.filter((t) => !expiredIds.has(t.id)));

      let needsServerSettle = false;

      for (const trade of expired) {
        if (settledTradeIdsRef.current.has(trade.id)) continue;
        settledTradeIdsRef.current.add(trade.id);

        const exitPriceNum =
          livePricesMapRef.current[trade.symbol] ?? trade.entryPriceNumber;
        const decimals = trade.symbol === 'EUR/USD' ? 4 : 2;
        const isWon =
          (trade.direction === 'CALL' &&
            exitPriceNum > trade.entryPriceNumber) ||
          (trade.direction === 'PUT' && exitPriceNum < trade.entryPriceNumber);
        const isDraw = Math.abs(exitPriceNum - trade.entryPriceNumber) < 1e-9;

        const status: 'WON' | 'LOST' | 'DRAW' = isDraw
          ? 'DRAW'
          : isWon
            ? 'WON'
            : 'LOST';
        const profitNum = isWon
          ? Number(
              ((trade.amountNumber * trade.payoutPercent) / 100).toFixed(2)
            )
          : 0;
        const totalPayoutNum = isWon
          ? Number((trade.amountNumber + profitNum).toFixed(2))
          : isDraw
            ? trade.amountNumber
            : 0;

        const durationSec = Math.max(
          1,
          Math.round(
            (new Date(trade.expiresAt).getTime() -
              new Date(trade.openedAt).getTime()) /
              1000
          )
        );
        const durationLabel = `${String(Math.floor(durationSec / 60)).padStart(
          2,
          '0'
        )}:${String(durationSec % 60).padStart(2, '0')}`;

        const expiresAtMs = new Date(trade.expiresAt).getTime();
        const justExpiredLive = now - expiresAtMs < 5000;

        // Show 1.5-second Quotex RESULT (P/L) badge & bottom-left card when expiring live
        if (justExpiredLive) {
          triggerTradeResultOverlay({
            id: trade.id,
            symbol: trade.symbol,
            direction: trade.direction,
            amount: trade.amountNumber,
            entryPrice: trade.entryPriceNumber,
            exitPrice: Number(exitPriceNum.toFixed(decimals)),
            status,
            totalPayout: totalPayoutNum,
            durationLabel,
            displayCurrency: trade.displayCurrency ?? currency,
            fxRateUsed: trade.fxRateUsed ?? rate,
          });
        }

        // Prepend to settled trades list immediately so there is no visual gap
        const closedRecord: ClosedTradeRecord = {
          id: trade.id,
          symbol: trade.symbol,
          direction: trade.direction,
          amount: trade.amountNumber.toFixed(2),
          amountNumber: trade.amountNumber,
          entryPrice: trade.entryPriceNumber.toFixed(decimals),
          entryPriceNumber: trade.entryPriceNumber,
          exitPrice: exitPriceNum.toFixed(decimals),
          exitPriceNumber: Number(exitPriceNum.toFixed(decimals)),
          payoutPercent: trade.payoutPercent,
          openedAt: trade.openedAt,
          expiresAt: trade.expiresAt,
          status,
          profit: profitNum.toFixed(2),
          profitNumber: profitNum,
          displayCurrency: trade.displayCurrency ?? currency,
          fxRateUsed: trade.fxRateUsed ?? rate,
        };

        setDrawerClosedTrades((prev) => {
          if (prev.some((c) => c.id === closedRecord.id)) return prev;
          return [closedRecord, ...prev.slice(0, 49)];
        });

        if (!configured || !userId || trade.id.startsWith('demo-')) {
          if (totalPayoutNum > 0) {
            setBalance((prev) =>
              Number((prev + totalPayoutNum).toFixed(2))
            );
          }
        } else {
          needsServerSettle = true;
        }
      }

      if (needsServerSettle && configured && userId) {
        const supabase = createClient();
        void (async () => {
          try {
            await supabase.rpc('settle_expired_trades');
            const { data: profileData } = await supabase
              .from('profiles')
              .select('balance')
              .eq('id', userId)
              .maybeSingle();
            if (profileData && profileData.balance !== undefined) {
              setBalance(Number(profileData.balance));
            }
            setHistoryRefreshTrigger((c) => c + 1);
            await loadRecentSettledForDrawer(
              userId,
              assetSymbolByIdRef.current
            );
          } catch {
            // Ignore RPC error if offline
          }
        })();
      }
    };

    const interval = setInterval(checkExpiredTrades, 250);
    return () => clearInterval(interval);
  }, [
    configured,
    userId,
    currency,
    rate,
    loadRecentSettledForDrawer,
    triggerTradeResultOverlay,
  ]);

  const handleChartTick = useCallback((tick: LiveTick) => {
    setLivePricesMap((prev) => {
      if (prev[tick.symbol] === tick.price) return prev;
      return {
        ...prev,
        [tick.symbol]: tick.price,
      };
    });
  }, []);

  const handleTradePlaced = useCallback(
    (tradeRow: TradeRow) => {
      const mapped = mapTradeRowToOpenItem(tradeRow);
      setOpenTradesList((prev) => {
        if (prev.some((t) => t.id === mapped.id)) return prev;
        return [mapped, ...prev];
      });
      setBalance((prev) =>
        Math.max(0, Number((prev - Number(tradeRow.amount)).toFixed(2)))
      );
    },
    [mapTradeRowToOpenItem]
  );

  async function handleSignOut() {
    setUserId(null);
    setUserNumber(null);
    setBalance(0);
    setOpenTradesList([]);
    setDrawerClosedTrades([]);
    setWalletRequests([]);
    setNotifications([]);
    await performFullLogout('logged_out');
    router.replace('/login?message=logged_out');
  }

  const assetOptions: AssetOption[] = useMemo(
    () =>
      marketList.map((m) => ({
        id: m.id,
        symbol: m.symbol,
        name: m.name,
        payoutPercent: m.payoutPercent,
        volatility: m.volatility,
        isActive: m.isActive,
      })),
    [marketList]
  );

  const activeAssetSummary =
    marketList.find((m) => m.symbol === selectedSymbol) ?? marketList[0];

  const activeSymbolOpenOverlays = useMemo(
    () =>
      openTradesList
        .filter(
          (t) =>
            t.symbol === selectedSymbol &&
            new Date(t.expiresAt).getTime() > (nowMs || Date.now())
        )
        .map((t) => ({
          id: t.id,
          direction: t.direction,
          amount: t.amountNumber,
          entryPrice: t.entryPriceNumber,
          openedAt: t.openedAt,
          expiresAt: t.expiresAt,
          payoutPercent: t.payoutPercent,
          displayCurrency: t.displayCurrency,
          fxRateUsed: t.fxRateUsed,
        })),
    [openTradesList, selectedSymbol, nowMs]
  );

  if (isCheckingAuth || !authenticatedUserId) {
    return (
      <LoadingScreen
        variant="fullscreen"
        label="Verifying Authenticated Trading Session"
      />
    );
  }

  return (
    <div className="flex-1 flex flex-col bg-[#171a23] text-slate-100 min-h-dvh lg:h-dvh lg:max-h-dvh lg:overflow-hidden">
      {/* TOP BAR: Exact QUOTEX Mobile Header on <1024px, Full QUOTEX Web Header on Desktop lg+ */}
      <header className="h-12 sm:h-14 bg-[#1c202e] lg:bg-[#171a24] border-b border-[#242938] px-3 sm:px-4 flex items-center justify-between gap-2 sm:gap-4 shrink-0 z-30">
        {/* Desktop Brand & Hamburger */}
        <div className="hidden lg:flex items-center gap-4 min-w-0">
          <button
            type="button"
            onClick={() => setDesktopMarketsDrawerOpen((prev) => !prev)}
            title="Toggle Live Markets Drawer"
            className="w-8 h-8 rounded-lg hover:bg-[#232837] text-slate-300 hover:text-white flex items-center justify-center transition-colors cursor-pointer"
          >
            <Menu className="w-5 h-5" />
          </button>

          <Link
            href="/dashboard"
            prefetch={false}
            className="flex items-center gap-2.5 shrink-0"
          >
            <div className="w-7 h-7 rounded-lg bg-[#252a3a] border border-[#343b4f] flex items-center justify-center">
              <BarChart3 className="w-4 h-4 text-[#22ab68]" />
            </div>
            <span className="text-base font-extrabold tracking-wider text-white">
              QUOTEX
            </span>
            <span className="hidden xl:inline text-[11px] font-bold tracking-[0.14em] text-[#5c6479] uppercase pl-1">
              • WEB TRADING PLATFORM
            </span>
          </Link>
        </div>

        {/* Mobile Full-Width Balance + Bell + Deposit Bar / Desktop Right Controls */}
        <div className="flex items-center justify-between lg:justify-end w-full lg:w-auto gap-2">
          <BalanceBadge
            balance={balance}
            userId={userId}
            userNumber={userNumber}
            notifications={notifications}
            onMarkNotificationsRead={async () => {
              setNotifications((prev) =>
                prev.map((n) => ({ ...n, is_read: true }))
              );
              if (configured && userId) {
                const supabase = createClient();
                await supabase.rpc('mark_notifications_read');
              }
            }}
            onOpenDepositModal={() => setWalletModalMode('DEPOSIT')}
            onOpenWithdrawModal={() => setWalletModalMode('WITHDRAW')}
            onBalanceUpdated={setBalance}
            onLogout={handleSignOut}
            onToast={showToast}
          />
          <button
            type="button"
            onClick={() => setWalletModalMode('WITHDRAW')}
            className="hidden lg:flex h-9 px-3.5 rounded-lg bg-[#282d3e] hover:bg-[#32384c] text-white text-xs font-bold items-center justify-center transition-colors cursor-pointer"
          >
            Withdrawal
          </button>
          <button
            type="button"
            onClick={handleSignOut}
            title="Log Out"
            className="hidden lg:flex h-9 px-2.5 rounded-lg bg-[#252a3a] hover:bg-[#31374a] text-[#8c94ab] hover:text-white items-center justify-center transition-colors cursor-pointer"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* ===================================================================== */}
      {/* UNIFIED RESPONSIVE WORKSPACE: Mobile/Tablet (<1024px) & Web (lg+)     */}
      {/* ===================================================================== */}
      <div className="flex-1 min-h-0 flex flex-col lg:flex-row lg:items-stretch w-full min-h-[calc(100dvh-48px)] lg:h-[calc(100dvh-56px)] lg:min-h-[calc(100dvh-56px)] lg:overflow-hidden relative bg-[#171a23]">
        {/* 1. DESKTOP LEFT SLIM VERTICAL ICON RAIL (lg: 1024px+) */}
        <aside className="hidden lg:flex w-14 shrink-0 self-stretch h-full bg-[#141722] border-r border-[#232838] flex-col items-center justify-between py-3 z-20 select-none">
          {/* Top Navigation Icons */}
          <div className="flex flex-col items-center gap-4">
            <button
              type="button"
              onClick={() => {
                setDesktopMarketsDrawerOpen(false);
                setDesktopFullHistoryOpen(false);
              }}
              title="Trading Chart"
              className="w-10 h-9 rounded-lg bg-[#1f2537] text-white flex items-center justify-center cursor-pointer"
            >
              <div className="w-5 h-4 rounded bg-white text-[#141722] flex items-center justify-center">
                <LineChart className="w-3.5 h-3.5 stroke-[2.5]" />
              </div>
            </button>

            <button
              type="button"
              onClick={() => setDesktopFullHistoryOpen((prev) => !prev)}
              title="Full Open Trades & Trade History Table"
              className={`w-10 h-9 rounded-lg flex items-center justify-center transition-colors cursor-pointer ${
                desktopFullHistoryOpen
                  ? 'bg-[#1d8cf8] text-white'
                  : 'text-[#7c849b] hover:text-white hover:bg-[#1c202e]'
              }`}
            >
              <HelpCircle className="w-5 h-5" />
            </button>

            <Link
              href="/profile"
              prefetch={false}
              title="Trader Profile & Stats"
              className="w-10 h-9 rounded-lg text-[#7c849b] hover:text-white hover:bg-[#1c202e] flex items-center justify-center transition-colors"
            >
              <User className="w-5 h-5" />
            </Link>

            <Link
              href="/wallet"
              prefetch={false}
              title="Account Wallet"
              className="w-10 h-9 rounded-lg text-[#7c849b] hover:text-white hover:bg-[#1c202e] flex items-center justify-center transition-colors relative"
            >
              <Wallet className="w-5 h-5" />
              <span className="absolute top-0.5 right-1 w-4 h-4 rounded-full bg-[#1d8cf8] text-white text-[9px] font-bold flex items-center justify-center">
                4
              </span>
            </Link>

            <button
              type="button"
              onClick={() => setDesktopMarketsDrawerOpen((prev) => !prev)}
              title="Live Markets List"
              className={`w-10 h-9 rounded-lg flex items-center justify-center transition-colors cursor-pointer ${
                desktopMarketsDrawerOpen
                  ? 'bg-[#252b3b] text-white'
                  : 'text-[#7c849b] hover:text-white hover:bg-[#1c202e]'
              }`}
            >
              <MoreHorizontal className="w-5 h-5" />
            </button>
          </div>

          {/* Bottom Utility Icons + JOIN US + Help Button (Matches QUOTEX Web Screenshot) */}
          <div className="flex flex-col items-center gap-3">
            <div className="grid grid-cols-2 gap-1.5 text-[#606882]">
              <button
                type="button"
                onClick={() => {
                  if (typeof document !== 'undefined') {
                    if (!document.fullscreenElement) {
                      document.documentElement.requestFullscreen?.().catch(() => {});
                    } else {
                      document.exitFullscreen?.().catch(() => {});
                    }
                  }
                }}
                title="Toggle Fullscreen"
                className="w-5 h-5 hover:text-white flex items-center justify-center cursor-pointer"
              >
                <Maximize2 className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setDesktopMarketsDrawerOpen((prev) => !prev)}
                title="Toggle Markets Panel"
                className="w-5 h-5 hover:text-white flex items-center justify-center cursor-pointer"
              >
                <Activity className="w-3.5 h-3.5" />
              </button>
              <Link
                href="/profile"
                prefetch={false}
                title="Settings & Profile"
                className="w-5 h-5 hover:text-white flex items-center justify-center"
              >
                <Settings className="w-3.5 h-3.5" />
              </Link>
              <button
                type="button"
                onClick={() =>
                  showToast({
                    type: 'info',
                    message: 'Sound alerts enabled for trade settlements.',
                  })
                }
                title="Sound Effects"
                className="w-5 h-5 hover:text-white flex items-center justify-center cursor-pointer"
              >
                <Volume2 className="w-3.5 h-3.5" />
              </button>
            </div>

            <Link
              href="/leaderboard"
              prefetch={false}
              className="w-11 py-1.5 rounded-lg bg-[#1c202e] border border-[#282e40] hover:border-[#3898ff] flex flex-col items-center justify-center gap-0.5 text-[8px] font-extrabold text-slate-200 tracking-tight transition-colors"
            >
              <MessageSquare className="w-3.5 h-3.5 text-[#3898ff]" />
              <span>JOIN US</span>
            </Link>

            <button
              type="button"
              onClick={() => setDesktopFullHistoryOpen(true)}
              className="w-11 py-1.5 rounded-lg bg-[#22ab68] hover:bg-[#1e995d] text-white flex flex-col items-center justify-center gap-0.5 text-[9px] font-bold shadow cursor-pointer transition-colors"
            >
              <span className="w-2 h-2 rounded-full bg-white" />
              <span>Help</span>
            </button>
          </div>
        </aside>

        {/* OPTIONAL COLLAPSIBLE LIVE MARKETS DRAWER (lg: 1024px+) */}
        {desktopMarketsDrawerOpen && (
          <div className="hidden lg:flex w-64 shrink-0 self-stretch bg-[#181c29] border-r border-[#262b38] flex-col z-20">
            <div className="px-3.5 py-2.5 border-b border-[#262b38] flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <Activity className="w-3.5 h-3.5 text-[#3898ff]" />
                <h2 className="text-xs font-bold text-white">Live Markets</h2>
              </div>
              <button
                type="button"
                onClick={() => setDesktopMarketsDrawerOpen(false)}
                className="text-slate-400 hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="divide-y divide-[#232836] flex-1 overflow-y-auto">
              {marketList.map((asset) => {
                const isSelected = asset.symbol === selectedSymbol;
                const livePrice = livePricesMap[asset.symbol] ?? asset.price;
                const isPositive = asset.changePercent >= 0;

                return (
                  <button
                    key={asset.symbol}
                    type="button"
                    onClick={() => {
                      setSelectedSymbol(asset.symbol);
                      setDesktopMarketsDrawerOpen(false);
                    }}
                    className={`w-full min-h-[54px] px-3.5 py-2.5 text-left transition-colors cursor-pointer flex items-center justify-between gap-2 ${
                      isSelected
                        ? 'bg-[#23293a] border-l-2 border-l-[#1d8cf8]'
                        : 'hover:bg-[#1f2433]'
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-bold text-white truncate">
                          {asset.symbol} (OTC)
                        </span>
                        <span className="text-[10px] font-mono font-bold text-[#f59e0b] tabular-nums">
                          {asset.payoutPercent}%
                        </span>
                      </div>
                      <div className="text-[10px] text-[#7c849b] truncate mt-0.5">
                        {asset.name}
                      </div>
                    </div>

                    <div className="text-right font-mono tabular-nums shrink-0">
                      <div
                        className={`text-xs font-bold flex items-center justify-end gap-0.5 ${
                          asset.direction === 'UP'
                            ? 'text-[#22ab68]'
                            : asset.direction === 'DOWN'
                              ? 'text-[#e34c3b]'
                              : 'text-white'
                        }`}
                      >
                        {asset.direction === 'UP' && (
                          <ArrowUp className="w-2.5 h-2.5" />
                        )}
                        {asset.direction === 'DOWN' && (
                          <ArrowDown className="w-2.5 h-2.5" />
                        )}
                        <span>{livePrice.toFixed(asset.decimals)}</span>
                      </div>
                      <div
                        className={`text-[10px] font-semibold mt-0.5 ${
                          isPositive ? 'text-[#22ab68]' : 'text-[#e34c3b]'
                        }`}
                      >
                        {isPositive ? '+' : ''}
                        {asset.changePercent.toFixed(2)}%
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* 2. UNIFIED FULL-HEIGHT, FULL-WIDTH CENTER PRICE CHART (Mobile, Tablet & Web) */}
        <main className="relative flex-1 self-stretch w-full min-w-0 min-h-[340px] sm:min-h-[400px] lg:min-h-[calc(100dvh-56px)] lg:h-full overflow-hidden">
          <PriceChart
            symbol={selectedSymbol}
            assetId={activeAssetSummary?.id}
            payoutPercent={activeAssetSummary?.payoutPercent ?? 85}
            assets={assetOptions}
            onSelectSymbol={(sym) => setSelectedSymbol(sym)}
            onTick={handleChartTick}
            openTrades={activeSymbolOpenOverlays}
            recentTradeResult={recentTradeResult}
            onDismissTradeResult={() => setRecentTradeResult(null)}
            hoverDirection={hoveredTradeDirection}
            mobileTradesDrawerOpen={mobileTradesDrawerOpen}
            onToggleMobileTradesDrawer={() =>
              setMobileTradesDrawerOpen((prev) => !prev)
            }
            totalTradesBadgeCount={
              openTradesList.length > 0
                ? openTradesList.length
                : drawerClosedTrades.length
            }
          />
        </main>

        {/* 3A. MOBILE & TABLET BOTTOM DOCK (< 1024px) */}
        <div className="lg:hidden shrink-0 flex flex-col w-full">
          {mobileTradesDrawerOpen ? (
            /* SCREENSHOT 1: Trades & History Bottom Drawer */
            <div className="h-[260px] sm:h-[290px] min-h-0 bg-[#1c202e] border-t border-[#2a3042] flex flex-col shrink-0 overflow-hidden">
              {/* 2-Tab Header: Trades (count) | Clock (count) */}
              <div className="grid grid-cols-2 border-b border-[#262b38] bg-[#191d29] shrink-0">
                <button
                  type="button"
                  onClick={() => setMobileDrawerTab('trades')}
                  className={`h-11 flex items-center justify-center gap-2 text-xs font-bold transition-colors cursor-pointer ${
                    mobileDrawerTab === 'trades'
                      ? 'text-white border-t-2 border-t-[#1d8cf8] bg-[#1c202e]'
                      : 'text-[#7c849b]'
                  }`}
                >
                  <span>Trades</span>
                  <span className="px-1.5 py-0.5 rounded-full bg-[#2a3042] text-[10px] font-mono text-slate-300 tabular-nums">
                    {openTradesList.length}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => setMobileDrawerTab('pending')}
                  className={`h-11 flex items-center justify-center gap-2 text-xs font-bold transition-colors cursor-pointer ${
                    mobileDrawerTab === 'pending'
                      ? 'text-white border-t-2 border-t-[#1d8cf8] bg-[#1c202e]'
                      : 'text-[#7c849b]'
                  }`}
                >
                  <Clock className="w-4 h-4" />
                  <span className="px-1.5 py-0.5 rounded-full bg-[#2a3042] text-[10px] font-mono text-slate-300 tabular-nums">
                    0
                  </span>
                </button>
              </div>

              {/* Trades List Body (Matches Screenshot 1: Date Pill + Trade Rows) */}
              <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 py-3 space-y-3 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-[#191d29] [&::-webkit-scrollbar-thumb]:bg-[#363d52] [&::-webkit-scrollbar-thumb]:rounded-full hover:[&::-webkit-scrollbar-thumb]:bg-[#4a536e]">
                <div className="flex items-center justify-center gap-1.5 py-1">
                  <span className="text-[11px] font-bold tracking-wider text-[#8c94ab] uppercase">
                    31 OCTOBER
                  </span>
                  <span className="w-5 h-5 rounded-full bg-[#363d52] text-slate-200 text-[10px] font-bold flex items-center justify-center tabular-nums">
                    {openTradesList.length + drawerClosedTrades.length}
                  </span>
                </div>

                {/* Active Open Trades */}
                {openTradesList.map((trade) => {
                  const effectiveNow =
                    nowMs > 0 ? nowMs : new Date(trade.openedAt).getTime();
                  const remainingSec = Math.max(
                    0,
                    Math.ceil(
                      (new Date(trade.expiresAt).getTime() - effectiveNow) / 1000
                    )
                  );
                  const mins = Math.floor(remainingSec / 60);
                  const secs = remainingSec % 60;
                  const timerStr = `${String(mins).padStart(2, '0')}:${String(
                    secs
                  ).padStart(2, '0')}`;
                  const expectedReturnBase = Number(
                    (
                      trade.amountNumber +
                      (trade.amountNumber * trade.payoutPercent) / 100
                    ).toFixed(2)
                  );

                  const currentSpot =
                    livePricesMap[trade.symbol] ??
                    marketList.find((m) => m.symbol === trade.symbol)?.price ??
                    trade.entryPriceNumber;

                  const isWinning =
                    (trade.direction === 'CALL' &&
                      currentSpot > trade.entryPriceNumber) ||
                    (trade.direction === 'PUT' &&
                      currentSpot < trade.entryPriceNumber);
                  const isDraw =
                    Math.abs(currentSpot - trade.entryPriceNumber) < 1e-9;

                  const origCur = trade.displayCurrency || 'USDT';
                  const origRate = trade.fxRateUsed ?? rate ?? 134.5;

                  return (
                    <div
                      key={trade.id}
                      title={`Placed in ${origCur} @ Rs ${Number(
                        origRate
                      ).toFixed(2)} · Base: $${trade.amountNumber.toFixed(2)}`}
                      className="py-2 border-b border-[#262b38]/80 space-y-1.5 text-xs"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <ChevronDown className="w-3.5 h-3.5 text-[#8c94ab]" />
                          <div className="relative flex items-center w-6 h-4">
                            <span className="w-3.5 h-3.5 rounded-full bg-[#1d4ed8] border border-white/40 flex items-center justify-center text-[7px] font-bold text-white">
                              {trade.symbol.slice(0, 1)}
                            </span>
                            <span className="w-3.5 h-3.5 rounded-full bg-[#e34c3b] border border-white/40 flex items-center justify-center text-[7px] font-bold text-white -ml-1">
                              +
                            </span>
                          </div>
                          <span className="font-bold text-white">
                            {trade.symbol} (OTC)
                          </span>
                        </div>
                        <span className="font-mono font-bold text-white tabular-nums">
                          {timerStr}
                        </span>
                      </div>

                      <div
                        className={`flex items-center justify-between pl-5 font-mono tabular-nums transition-opacity duration-150 ${
                          isFading ? 'opacity-30' : 'opacity-100'
                        }`}
                      >
                        <div className="flex items-center gap-1.5">
                          <span
                            className={`w-4 h-4 rounded-full flex items-center justify-center ${
                              trade.direction === 'CALL'
                                ? 'bg-[#22ab68]/25 text-[#22ab68]'
                                : 'bg-[#e34c3b]/25 text-[#e34c3b]'
                            }`}
                          >
                            {trade.direction === 'CALL' ? (
                              <ArrowUp className="w-2.5 h-2.5" />
                            ) : (
                              <ArrowDown className="w-2.5 h-2.5" />
                            )}
                          </span>
                          <span
                            className={`font-bold ${
                              trade.direction === 'CALL'
                                ? 'text-[#22ab68]'
                                : 'text-[#e34c3b]'
                            }`}
                          >
                            {formatMoney(trade.amountNumber, {
                              tradeDisplayCurrency: origCur,
                              tradeFxRateUsed: origRate,
                            })}
                          </span>
                        </div>

                        <span
                          className={`font-bold ${
                            isWinning
                              ? 'text-[#22ab68]'
                              : isDraw
                                ? 'text-slate-400'
                                : 'text-[#e34c3b]'
                          }`}
                        >
                          {isWinning
                            ? formatMoney(expectedReturnBase, {
                                showPlusSign: true,
                                tradeDisplayCurrency: origCur,
                                tradeFxRateUsed: origRate,
                              })
                            : isDraw
                              ? formatMoney(trade.amountNumber, {
                                  showPlusSign: true,
                                  tradeDisplayCurrency: origCur,
                                  tradeFxRateUsed: origRate,
                                })
                              : formatMoney(0, {
                                  tradeDisplayCurrency: origCur,
                                  tradeFxRateUsed: origRate,
                                })}
                        </span>
                      </div>
                    </div>
                  );
                })}

                {/* Settled Trades */}
                {drawerClosedTrades.map((trade) => {
                  const amtNum =
                    trade.amountNumber ??
                    Number(String(trade.amount).replace(/,/g, ''));
                  const profNum = trade.profitNumber ?? 0;
                  const totalPayoutBase =
                    trade.status === 'WON'
                      ? Number((amtNum + profNum).toFixed(2))
                      : trade.status === 'DRAW'
                        ? amtNum
                        : 0;
                  const origCur = trade.displayCurrency || 'USDT';
                  const origRate = trade.fxRateUsed ?? rate ?? 134.5;

                  return (
                    <div
                      key={trade.id}
                      title={`Placed in ${origCur} @ Rs ${Number(
                        origRate
                      ).toFixed(2)} · Base: $${amtNum.toFixed(2)}`}
                      className="py-2 border-b border-[#262b38]/80 space-y-1.5 text-xs"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <ChevronDown className="w-3.5 h-3.5 text-[#8c94ab]" />
                          <div className="relative flex items-center w-6 h-4">
                            <span className="w-3.5 h-3.5 rounded-full bg-[#1d4ed8] border border-white/40 flex items-center justify-center text-[7px] font-bold text-white">
                              {trade.symbol.slice(0, 1)}
                            </span>
                            <span className="w-3.5 h-3.5 rounded-full bg-[#e34c3b] border border-white/40 flex items-center justify-center text-[7px] font-bold text-white -ml-1">
                              +
                            </span>
                          </div>
                          <span className="font-bold text-white">
                            {trade.symbol}
                          </span>
                        </div>
                        <span className="font-mono text-slate-300 tabular-nums">
                          00:01:00
                        </span>
                      </div>

                      <div
                        className={`flex items-center justify-between pl-5 font-mono tabular-nums transition-opacity duration-150 ${
                          isFading ? 'opacity-30' : 'opacity-100'
                        }`}
                      >
                        <div className="flex items-center gap-1.5">
                          <span
                            className={`w-4 h-4 rounded-full flex items-center justify-center ${
                              trade.direction === 'CALL'
                                ? 'bg-[#22ab68]/25 text-[#22ab68]'
                                : 'bg-[#e34c3b]/25 text-[#e34c3b]'
                            }`}
                          >
                            {trade.direction === 'CALL' ? (
                              <ArrowUp className="w-2.5 h-2.5" />
                            ) : (
                              <ArrowDown className="w-2.5 h-2.5" />
                            )}
                          </span>
                          <span
                            className={`font-bold ${
                              trade.direction === 'CALL'
                                ? 'text-[#22ab68]'
                                : 'text-[#e34c3b]'
                            }`}
                          >
                            {formatMoney(amtNum, {
                              tradeDisplayCurrency: origCur,
                              tradeFxRateUsed: origRate,
                            })}
                          </span>
                        </div>

                        <span
                          className={`font-bold ${
                            trade.status === 'WON'
                              ? 'text-[#22ab68]'
                              : trade.status === 'LOST'
                                ? 'text-[#e34c3b]'
                                : 'text-slate-400'
                          }`}
                        >
                          {formatMoney(totalPayoutBase, {
                            showPlusSign: trade.status === 'WON',
                            tradeDisplayCurrency: origCur,
                            tradeFxRateUsed: origRate,
                          })}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            /* SCREENSHOT 2: Trade Execution Panel + 5-Icon Bottom Bar */
            <div className="shrink-0 flex flex-col">
              <TradePanel
                symbol={selectedSymbol}
                payoutPercent={activeAssetSummary?.payoutPercent ?? 85}
                currentPrice={
                  livePricesMap[selectedSymbol] ?? activeAssetSummary?.price ?? 0
                }
                balance={balance}
                openTradesCount={openTradesList.length}
                assets={assetOptions}
                onSelectSymbol={(sym) => setSelectedSymbol(sym)}
                onTradePlaced={handleTradePlaced}
                onHoverDirectionChange={setHoveredTradeDirection}
                onToast={showToast}
              />

              {/* Mobile Bottom Navigation Bar */}
              <nav
                aria-label="Mobile bottom navigation"
                className="h-12 bg-[#141722] border-t border-[#232838] grid grid-cols-4 items-center px-2"
              >
                <button
                  type="button"
                  onClick={() => setMobileTradesDrawerOpen(false)}
                  aria-label="Trading Chart"
                  className="h-full flex items-center justify-center text-white cursor-pointer"
                >
                  <div className="w-6 h-5 rounded bg-white text-[#141722] flex items-center justify-center">
                    <LineChart className="w-4 h-4 stroke-[2.5]" />
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => setMobileTradesDrawerOpen((prev) => !prev)}
                  aria-label="Help & Trade History"
                  className="h-full flex items-center justify-center text-[#606882] hover:text-white cursor-pointer"
                >
                  <HelpCircle className="w-5 h-5" />
                </button>

                <Link
                  href="/profile"
                  prefetch={false}
                  aria-label="Trader Profile & Stats"
                  className="h-full flex items-center justify-center text-[#606882] hover:text-white"
                >
                  <User className="w-5 h-5" />
                </Link>

                <Link
                  href="/wallet"
                  prefetch={false}
                  aria-label="Account Wallet"
                  className="h-full flex items-center justify-center text-[#606882] hover:text-white"
                >
                  <span className="relative inline-flex">
                    <MoreHorizontal className="w-5 h-5" />
                    <span className="absolute -top-1.5 -right-2.5 w-4 h-4 rounded-full bg-[#1d8cf8] text-white text-[9px] font-bold flex items-center justify-center">
                      4
                    </span>
                  </span>
                </Link>
              </nav>
            </div>
          )}
        </div>

        {/* 3B. DESKTOP RIGHT SIDEBAR: <TradePanel /> + QUOTEX Trades / History Inspector (lg: 1024px+) */}
        <aside className="hidden lg:flex w-[265px] xl:w-[280px] shrink-0 self-stretch h-full max-h-full min-h-0 bg-[#141722] border-l border-[#232838] p-2 flex-col gap-2 overflow-hidden z-20">
          {/* Top Execution Card */}
          <div className="shrink-0">
            <TradePanel
              symbol={selectedSymbol}
              payoutPercent={activeAssetSummary?.payoutPercent ?? 85}
              currentPrice={
                livePricesMap[selectedSymbol] ?? activeAssetSummary?.price ?? 0
              }
              balance={balance}
              openTradesCount={openTradesList.length}
              assets={assetOptions}
              onSelectSymbol={(sym) => setSelectedSymbol(sym)}
              onTradePlaced={handleTradePlaced}
              onHoverDirectionChange={setHoveredTradeDirection}
              onToast={showToast}
            />
          </div>

          {/* Bottom Trades / History Card (Matches QUOTEX Web Screenshot) */}
          <div className="flex-1 min-h-0 bg-[#202534] border border-[#2a3042] rounded-lg flex flex-col overflow-hidden">
            {/* 2-Tab Header: Trades (count) | Clock (0) */}
            <div className="grid grid-cols-2 border-b border-[#2a3042] bg-[#1a1e2b] shrink-0">
              <button
                type="button"
                onClick={() => setMobileDrawerTab('trades')}
                className={`h-9 flex items-center justify-center gap-1.5 text-[11px] font-bold transition-colors cursor-pointer ${
                  mobileDrawerTab === 'trades'
                    ? 'text-white border-t-2 border-t-[#1d8cf8] bg-[#202534]'
                    : 'text-[#7c849b] hover:text-slate-200'
                }`}
              >
                <span>Trades</span>
                <span className="px-1.5 py-0.2 rounded-full bg-[#2b3145] text-[10px] font-mono text-slate-300 tabular-nums">
                  {openTradesList.length}
                </span>
              </button>

              <button
                type="button"
                onClick={() => setMobileDrawerTab('pending')}
                className={`h-9 flex items-center justify-center gap-1.5 text-[11px] font-bold transition-colors cursor-pointer ${
                  mobileDrawerTab === 'pending'
                    ? 'text-white border-t-2 border-t-[#1d8cf8] bg-[#202534]'
                    : 'text-[#7c849b] hover:text-slate-200'
                }`}
              >
                <Clock className="w-3.5 h-3.5" />
                <span className="px-1.5 py-0.2 rounded-full bg-[#2b3145] text-[10px] font-mono text-slate-300 tabular-nums">
                  0
                </span>
              </button>
            </div>

            {/* Scrollable Trades & Expanded Ticket Inspector */}
            <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-3 py-2.5 space-y-2.5 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-[#1a1e2b] [&::-webkit-scrollbar-thumb]:bg-[#363d52] [&::-webkit-scrollbar-thumb]:rounded-full hover:[&::-webkit-scrollbar-thumb]:bg-[#4a536e]">
              {/* Date Group Header */}
              <div className="flex items-center justify-center gap-1.5 py-0.5">
                <span className="text-[10px] font-extrabold tracking-wider text-[#8c94ab] uppercase">
                  31 OCTOBER
                </span>
                <span className="w-4 h-4 rounded-full bg-[#363d52] text-slate-200 text-[9px] font-bold flex items-center justify-center tabular-nums">
                  {openTradesList.length + drawerClosedTrades.length}
                </span>
              </div>

              {/* Active Open Trades */}
              {openTradesList.map((trade) => {
                const effectiveNow =
                  nowMs > 0 ? nowMs : new Date(trade.openedAt).getTime();
                const remainingSec = Math.max(
                  0,
                  Math.ceil(
                    (new Date(trade.expiresAt).getTime() - effectiveNow) / 1000
                  )
                );
                const mins = Math.floor(remainingSec / 60);
                const secs = remainingSec % 60;
                const timerStr = `${String(mins).padStart(2, '0')}:${String(
                  secs
                ).padStart(2, '0')}`;
                const expectedReturnBase = Number(
                  (
                    trade.amountNumber +
                    (trade.amountNumber * trade.payoutPercent) / 100
                  ).toFixed(2)
                );

                const currentSpot =
                  livePricesMap[trade.symbol] ??
                  marketList.find((m) => m.symbol === trade.symbol)?.price ??
                  trade.entryPriceNumber;

                const isWinning =
                  (trade.direction === 'CALL' &&
                    currentSpot > trade.entryPriceNumber) ||
                  (trade.direction === 'PUT' &&
                    currentSpot < trade.entryPriceNumber);
                const isDraw =
                  Math.abs(currentSpot - trade.entryPriceNumber) < 1e-9;

                const origCur = trade.displayCurrency || 'USDT';
                const origRate = trade.fxRateUsed ?? rate ?? 134.5;

                return (
                  <div
                    key={trade.id}
                    title={`Placed in ${origCur} @ Rs ${Number(
                      origRate
                    ).toFixed(2)} · Base: $${trade.amountNumber.toFixed(2)}`}
                    className="py-2 border-b border-[#2a3042]/80 space-y-1 text-[11px]"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <ChevronDown className="w-3 h-3 text-[#8c94ab] shrink-0" />
                        <div className="relative flex items-center w-5 h-3.5 shrink-0">
                          <span className="w-3 h-3 rounded-full bg-[#1d4ed8] border border-white/40 flex items-center justify-center text-[6px] font-bold text-white">
                            {trade.symbol.slice(0, 1)}
                          </span>
                          <span className="w-3 h-3 rounded-full bg-[#e34c3b] border border-white/40 flex items-center justify-center text-[6px] font-bold text-white -ml-1">
                            +
                          </span>
                        </div>
                        <span className="font-bold text-white truncate">
                          {trade.symbol} (OTC)
                        </span>
                      </div>
                      <span className="font-mono font-bold text-white tabular-nums shrink-0">
                        {timerStr}
                      </span>
                    </div>

                    <div
                      className={`flex items-center justify-between pl-4 font-mono tabular-nums transition-opacity duration-150 ${
                        isFading ? 'opacity-30' : 'opacity-100'
                      }`}
                    >
                      <div className="flex items-center gap-1">
                        <span
                          className={`w-3.5 h-3.5 rounded-full flex items-center justify-center ${
                            trade.direction === 'CALL'
                              ? 'bg-[#22ab68]/25 text-[#22ab68]'
                              : 'bg-[#e34c3b]/25 text-[#e34c3b]'
                          }`}
                        >
                          {trade.direction === 'CALL' ? (
                            <ArrowUp className="w-2.5 h-2.5" />
                          ) : (
                            <ArrowDown className="w-2.5 h-2.5" />
                          )}
                        </span>
                        <span
                          className={`font-bold ${
                            trade.direction === 'CALL'
                              ? 'text-[#22ab68]'
                              : 'text-[#e34c3b]'
                          }`}
                        >
                          {formatMoney(trade.amountNumber, {
                            tradeDisplayCurrency: origCur,
                            tradeFxRateUsed: origRate,
                          })}
                        </span>
                      </div>

                      <span
                        className={`font-bold ${
                          isWinning
                            ? 'text-[#22ab68]'
                            : isDraw
                              ? 'text-slate-400'
                              : 'text-[#e34c3b]'
                        }`}
                      >
                        {isWinning
                          ? formatMoney(expectedReturnBase, {
                              showPlusSign: true,
                              tradeDisplayCurrency: origCur,
                              tradeFxRateUsed: origRate,
                            })
                          : isDraw
                            ? formatMoney(trade.amountNumber, {
                                showPlusSign: true,
                                tradeDisplayCurrency: origCur,
                                tradeFxRateUsed: origRate,
                              })
                            : formatMoney(0, {
                                tradeDisplayCurrency: origCur,
                                tradeFxRateUsed: origRate,
                              })}
                      </span>
                    </div>
                  </div>
                );
              })}

              {/* Settled Trades with Expandable QUOTEX Ticket Inspector */}
              {drawerClosedTrades.map((trade) => {
                const amtNum =
                  trade.amountNumber ??
                  Number(String(trade.amount).replace(/,/g, ''));
                const profNum = trade.profitNumber ?? 0;
                const totalPayoutBase =
                  trade.status === 'WON'
                    ? Number((amtNum + profNum).toFixed(2))
                    : trade.status === 'DRAW'
                      ? amtNum
                      : 0;
                const origCur = trade.displayCurrency || 'USDT';
                const origRate = trade.fxRateUsed ?? rate ?? 134.5;
                const isExpanded = expandedTradeId === trade.id;

                return (
                  <div
                    key={trade.id}
                    title={`Placed in ${origCur} @ Rs ${Number(
                      origRate
                    ).toFixed(2)} · Base: $${amtNum.toFixed(2)}`}
                    className="py-2 border-b border-[#2a3042]/80 space-y-2 text-[11px]"
                  >
                    <button
                      type="button"
                      onClick={() =>
                        setExpandedTradeId(isExpanded ? null : trade.id)
                      }
                      className="w-full text-left space-y-1 cursor-pointer"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1.5 min-w-0">
                          {isExpanded ? (
                            <ChevronUp className="w-3 h-3 text-[#8c94ab] shrink-0" />
                          ) : (
                            <ChevronDown className="w-3 h-3 text-[#8c94ab] shrink-0" />
                          )}
                          <div className="relative flex items-center w-5 h-3.5 shrink-0">
                            <span className="w-3 h-3 rounded-full bg-[#1d4ed8] border border-white/40 flex items-center justify-center text-[6px] font-bold text-white">
                              {trade.symbol.slice(0, 1)}
                            </span>
                            <span className="w-3 h-3 rounded-full bg-[#e34c3b] border border-white/40 flex items-center justify-center text-[6px] font-bold text-white -ml-1">
                              +
                            </span>
                          </div>
                          <span className="font-bold text-white truncate">
                            {trade.symbol} (OTC)
                          </span>
                        </div>
                        <span className="font-mono text-slate-300 tabular-nums shrink-0">
                          00:01:00
                        </span>
                      </div>

                      <div
                        className={`flex items-center justify-between pl-4 font-mono tabular-nums transition-opacity duration-150 ${
                          isFading ? 'opacity-30' : 'opacity-100'
                        }`}
                      >
                        <div className="flex items-center gap-1">
                          <span
                            className={`w-3.5 h-3.5 rounded-full flex items-center justify-center ${
                              trade.direction === 'CALL'
                                ? 'bg-[#22ab68]/25 text-[#22ab68]'
                                : 'bg-[#e34c3b]/25 text-[#e34c3b]'
                            }`}
                          >
                            {trade.direction === 'CALL' ? (
                              <ArrowUp className="w-2.5 h-2.5" />
                            ) : (
                              <ArrowDown className="w-2.5 h-2.5" />
                            )}
                          </span>
                          <span
                            className={`font-bold ${
                              trade.direction === 'CALL'
                                ? 'text-[#22ab68]'
                                : 'text-[#e34c3b]'
                            }`}
                          >
                            {formatMoney(amtNum, {
                              tradeDisplayCurrency: origCur,
                              tradeFxRateUsed: origRate,
                            })}
                          </span>
                        </div>

                        <span
                          className={`font-bold ${
                            trade.status === 'WON'
                              ? 'text-[#22ab68]'
                              : trade.status === 'LOST'
                                ? 'text-[#e34c3b]'
                                : 'text-slate-400'
                          }`}
                        >
                          {formatMoney(totalPayoutBase, {
                            showPlusSign: trade.status === 'WON',
                            tradeDisplayCurrency: origCur,
                            tradeFxRateUsed: origRate,
                          })}
                        </span>
                      </div>
                    </button>

                    {/* Expanded Mini Chart & Ticket Metadata */}
                    {isExpanded && (
                      <div className="pt-1.5 space-y-2 text-[10px] border-t border-[#2a3042]/60">
                        <div className="h-20 w-full rounded bg-[#181c29] border border-[#262b38] relative overflow-hidden p-1">
                          <svg
                            viewBox="0 0 220 70"
                            className="w-full h-full overflow-visible"
                          >
                            <line
                              x1="0"
                              y1="34"
                              x2="220"
                              y2="34"
                              stroke="#22ab68"
                              strokeWidth="1"
                            />
                            <path
                              d={
                                trade.status === 'WON'
                                  ? 'M 0 42 L 28 38 L 55 30 L 85 22 L 115 24 L 145 18 L 178 25 L 220 14'
                                  : 'M 0 32 L 28 30 L 55 24 L 85 18 L 115 20 L 145 42 L 178 52 L 220 48'
                              }
                              fill="none"
                              stroke="#3898ff"
                              strokeWidth="1.5"
                            />
                          </svg>
                        </div>

                        <div className="space-y-1.5 font-mono text-[10px]">
                          <div>
                            <div className="text-[#6c748a] font-sans">ID:</div>
                            <div className="text-slate-300 break-all">
                              {trade.id}
                            </div>
                          </div>
                          <div>
                            <div className="text-[#6c748a] font-sans">
                              Trade Pair:
                            </div>
                            <div className="text-slate-200 font-sans font-semibold">
                              {trade.symbol} (OTC){' '}
                              <span className="text-[#6c748a]">
                                • {trade.payoutPercent}%
                              </span>
                            </div>
                          </div>
                          <div>
                            <div className="text-[#6c748a] font-sans">
                              Currency &amp; FX Rate Snapshot:
                            </div>
                            <div className="text-slate-200">
                              {origCur} (1 USDT = Rs{' '}
                              {Number(origRate).toFixed(2)}) · Base: $
                              {amtNum.toFixed(2)}
                            </div>
                          </div>
                          <div>
                            <div className="text-[#6c748a] font-sans">
                              Open Price:
                            </div>
                            <div className="text-slate-200">
                              {trade.entryPrice}
                            </div>
                          </div>
                          <div>
                            <div className="text-[#6c748a] font-sans">
                              Close Price:
                            </div>
                            <div className="text-slate-200">
                              {trade.exitPrice ?? trade.entryPrice}
                            </div>
                          </div>
                          <div>
                            <div className="text-[#6c748a] font-sans">
                              Open time:
                            </div>
                            <div
                              suppressHydrationWarning
                              className="text-slate-300"
                            >
                              {new Date(trade.openedAt)
                                .toISOString()
                                .replace('T', ' ')
                                .slice(0, 22)}
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Footer Button to Open Full History & Open Trades Modal */}
            <div className="p-2 border-t border-[#2a3042] bg-[#1a1e2b] shrink-0">
              <button
                type="button"
                onClick={() => setDesktopFullHistoryOpen(true)}
                className="w-full py-1.5 px-2.5 rounded bg-[#252b3d] hover:bg-[#2f364d] text-[10px] font-bold text-slate-300 hover:text-white text-center transition-colors cursor-pointer"
              >
                Full Trades & History Table
              </button>
            </div>
          </div>
        </aside>

        {/* FULL OPEN TRADES & TRADE HISTORY MODAL OVERLAY */}
        {desktopFullHistoryOpen && (
          <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-center justify-center p-6">
            <div className="w-full max-w-5xl max-h-[85vh] bg-[#171a23] border border-[#2e3446] rounded-2xl shadow-2xl flex flex-col overflow-hidden">
              <div className="px-5 py-3.5 border-b border-[#262b38] bg-[#1c202b] flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Activity className="w-4 h-4 text-[#3898ff]" />
                  <h2 className="text-sm font-bold text-white">
                    Open Positions & Settled Trade History
                  </h2>
                </div>
                <button
                  type="button"
                  onClick={() => setDesktopFullHistoryOpen(false)}
                  className="w-8 h-8 rounded-lg bg-[#252a3a] hover:bg-[#31384d] text-slate-300 hover:text-white flex items-center justify-center cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="p-5 overflow-y-auto space-y-4">
                <OpenTrades
                  openTrades={openTradesList}
                  livePrices={livePricesMap}
                />
                <TradeHistory
                  userId={userId}
                  assetSymbolById={assetSymbolById}
                  refreshTrigger={historyRefreshTrigger}
                />
              </div>
            </div>
          </div>
        )}
      </div>

      <WalletActionModal
        isOpen={walletModalMode !== null}
        initialMode={walletModalMode || 'DEPOSIT'}
        onClose={() => setWalletModalMode(null)}
        userId={userId}
        userNumber={userNumber}
        userStatus={userStatus}
        balance={balance}
        pendingWithdrawalsTotal={walletRequests
          .filter((r) => r.status === 'PENDING' && r.type === 'WITHDRAW')
          .reduce((acc, r) => acc + Number(r.amount), 0)}
        pendingRequestsCount={
          walletRequests.filter((r) => r.status === 'PENDING').length
        }
        onRequestCreated={(req) => {
          setWalletRequests((prev) =>
            prev.some((r) => r.id === req.id) ? prev : [req, ...prev]
          );
        }}
        onToast={showToast}
      />

      <ToastBanner toast={toast} onDismiss={() => setToast(null)} />
    </div>
  );
}
