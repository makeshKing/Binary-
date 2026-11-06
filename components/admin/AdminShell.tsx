'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  LayoutDashboard,
  Users,
  WalletCards,
  ScrollText,
  Activity,
  CandlestickChart,
  ShieldAlert,
  Settings,
  UserCog,
  LogOut,
  ShieldCheck,
  Clock,
  Menu,
  X,
  AlertTriangle,
  Search,
  ArrowRight,
  ArrowLeftRight,
  QrCode,
} from 'lucide-react';
import { AdminSessionInfo } from '@/lib/supabase/admin-server';
import { clearAdminCookiesOnly } from '@/lib/supabase/admin-client';
import { ProfileRow, resolveUserNumber } from '@/lib/supabase/types';
import { CurrencyToggleButton, useCurrency } from '@/components/CurrencyProvider';

interface NavItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  minRole: 'SUPPORT' | 'ADMIN' | 'SUPERADMIN';
  badge?: string;
}

const NAV_ITEMS: NavItem[] = [
  {
    href: '/admin',
    label: 'Dashboard',
    icon: LayoutDashboard,
    minRole: 'SUPPORT',
  },
  {
    href: '/admin/users',
    label: 'Users',
    icon: Users,
    minRole: 'SUPPORT',
  },
  {
    href: '/admin/requests',
    label: 'Wallet Requests',
    icon: WalletCards,
    minRole: 'ADMIN',
  },
  {
    href: '/admin/ledger',
    label: 'Balance Ledger',
    icon: ScrollText,
    minRole: 'SUPPORT',
  },
  {
    href: '/admin/trades',
    label: 'Trades Monitor',
    icon: Activity,
    minRole: 'SUPPORT',
  },
  {
    href: '/admin/assets',
    label: 'Market Assets',
    icon: CandlestickChart,
    minRole: 'ADMIN',
  },
  {
    href: '/admin/audit-log',
    label: 'Audit Log',
    icon: ShieldAlert,
    minRole: 'SUPERADMIN',
  },
  {
    href: '/admin/settings/payment-details',
    label: 'Payment Details',
    icon: QrCode,
    minRole: 'ADMIN',
  },
  {
    href: '/admin/settings/exchange-rate',
    label: 'Exchange Rate',
    icon: ArrowLeftRight,
    minRole: 'ADMIN',
  },
  {
    href: '/admin/settings',
    label: 'Settings & 2FA',
    icon: Settings,
    minRole: 'SUPPORT',
  },
  {
    href: '/admin/settings/admins',
    label: 'Admin Roles',
    icon: UserCog,
    minRole: 'SUPERADMIN',
  },
];

function roleRank(role: string): number {
  switch (role) {
    case 'SUPERADMIN':
      return 3;
    case 'ADMIN':
      return 2;
    case 'SUPPORT':
      return 1;
    default:
      return 0;
  }
}

const INACTIVITY_LIMIT_MS = 30 * 60 * 1000; // 30 minutes
const WARNING_THRESHOLD_MS = 29 * 60 * 1000; // 29 minutes (warning 1 minute before)

export default function AdminShell({
  session,
  children,
}: {
  session: AdminSessionInfo;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const { formatMoney } = useCurrency();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [showInactivityWarning, setShowInactivityWarning] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(60);
  const lastActivityRef = useRef<number>(Date.now());

  // Global Admin Top Bar Search State (debounced server-side query)
  const [globalQuery, setGlobalQuery] = useState<string>('');
  const [searchResults, setSearchResults] = useState<ProfileRow[]>([]);
  const [searchLoading, setSearchLoading] = useState<boolean>(false);
  const [searchOpen, setSearchOpen] = useState<boolean>(false);
  const searchBoxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleOutside(e: MouseEvent) {
      if (
        searchBoxRef.current &&
        !searchBoxRef.current.contains(e.target as Node)
      ) {
        setSearchOpen(false);
      }
    }
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, []);

  useEffect(() => {
    const trimmed = globalQuery.trim();
    if (!trimmed) {
      setSearchResults([]);
      setSearchLoading(false);
      return;
    }

    setSearchLoading(true);
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/admin/actions?view=search-users&q=${encodeURIComponent(trimmed)}`,
          { cache: 'no-store' }
        );
        if (res.ok) {
          const json = await res.json();
          setSearchResults((json.users || []).slice(0, 8));
          setSearchOpen(true);
        }
      } catch {
        // Ignore transient search errors
      } finally {
        setSearchLoading(false);
      }
    }, 220);

    return () => clearTimeout(timer);
  }, [globalQuery]);

  const handleGlobalSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = globalQuery.trim();
    if (!trimmed) return;
    setSearchOpen(false);
    // If exact 5-digit match is first result, jump straight to user detail or users directory
    if (/^\d{5}$/.test(trimmed) && searchResults.length > 0) {
      const exactMatch = searchResults.find(
        (u) => resolveUserNumber(u.user_number, u.id) === Number(trimmed)
      );
      if (exactMatch) {
        router.push(`/admin/users/${exactMatch.id}`);
        return;
      }
    }
    router.push(`/admin/users?q=${encodeURIComponent(trimmed)}`);
  };

  const handleLogout = useCallback(
    async (reason?: string) => {
      if (loggingOut) return;
      setLoggingOut(true);
      try {
        await fetch('/api/admin/auth', { method: 'DELETE' });
      } catch {
        // Ignore network errors during logout
      }
      clearAdminCookiesOnly();
      const target = reason
        ? `/admin/login?reason=${encodeURIComponent(reason)}`
        : '/admin/login';
      router.replace(target);
      router.refresh();
    },
    [loggingOut, router]
  );

  // Reset activity timer on user interactions
  const resetActivityTimer = useCallback(() => {
    lastActivityRef.current = Date.now();
    if (showInactivityWarning) {
      setShowInactivityWarning(false);
      setSecondsLeft(60);
    }
  }, [showInactivityWarning]);

  useEffect(() => {
    const events = ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart'];
    const onUserActivity = () => {
      if (!showInactivityWarning) {
        lastActivityRef.current = Date.now();
      }
    };

    events.forEach((ev) => window.addEventListener(ev, onUserActivity, { passive: true }));
    return () => {
      events.forEach((ev) => window.removeEventListener(ev, onUserActivity));
    };
  }, [showInactivityWarning]);

  useEffect(() => {
    const interval = setInterval(() => {
      const elapsed = Date.now() - lastActivityRef.current;
      if (elapsed >= INACTIVITY_LIMIT_MS) {
        handleLogout('inactivity');
      } else if (elapsed >= WARNING_THRESHOLD_MS) {
        const remainingSec = Math.max(
          1,
          Math.ceil((INACTIVITY_LIMIT_MS - elapsed) / 1000)
        );
        setShowInactivityWarning(true);
        setSecondsLeft(remainingSec);
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [handleLogout]);

  const visibleNavItems = NAV_ITEMS.filter(
    (item) => roleRank(session.role) >= roleRank(item.minRole)
  );

  const roleBadgeColor =
    session.role === 'SUPERADMIN'
      ? 'bg-amber-500/15 text-amber-300 border-amber-500/30'
      : session.role === 'ADMIN'
      ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
      : 'bg-sky-500/15 text-sky-300 border-sky-500/30';

  return (
    <div className="min-h-screen bg-[#070B12] text-slate-100 flex flex-col md:flex-row font-sans selection:bg-indigo-500/30">
      {/* 30-Minute Inactivity Warning Modal (1 minute before auto sign-out) */}
      {showInactivityWarning && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded-xl border border-amber-500/40 bg-[#0D131F] p-6 shadow-2xl">
            <div className="flex items-center gap-3 text-amber-400 mb-3">
              <AlertTriangle className="w-6 h-6 shrink-0" />
              <h3 className="text-lg font-semibold text-white">
                Session Inactivity Warning
              </h3>
            </div>
            <p className="text-sm text-slate-300 leading-relaxed mb-4">
              Your admin console session has been inactive for 29 minutes. For security,
              you will be automatically signed out in{' '}
              <span className="font-mono font-bold text-amber-400">{secondsLeft}s</span>.
            </p>
            <div className="flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => handleLogout('inactivity')}
                className="px-4 py-2 rounded-lg text-xs font-medium border border-slate-700 text-slate-300 hover:bg-slate-800"
              >
                Sign Out Now
              </button>
              <button
                type="button"
                onClick={resetActivityTimer}
                className="px-4 py-2 rounded-lg text-xs font-semibold bg-amber-500 text-slate-950 hover:bg-amber-400"
              >
                Stay Signed In
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Left Sidebar (Desktop) & Slide-Over (Mobile) */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 w-64 bg-[#0B101B] border-r border-slate-800/80 flex flex-col transition-transform duration-200 md:static md:translate-x-0 ${
          mobileMenuOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {/* Brand Header */}
        <div className="h-16 px-5 flex items-center justify-between border-b border-slate-800/80">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-indigo-500/15 border border-indigo-500/40 flex items-center justify-center text-indigo-400">
              <ShieldCheck className="w-4 h-4" />
            </div>
            <div>
              <div className="text-sm font-bold tracking-tight text-white">
                Admin Console
              </div>
              <div className="text-[10px] font-mono uppercase tracking-wider text-slate-400">
                Live Platform Management
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setMobileMenuOpen(false)}
            className="md:hidden text-slate-400 hover:text-white"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Role Scope Indicator */}
        <div className="px-4 py-3 border-b border-slate-800/60 bg-slate-900/30">
          <div className="flex items-center justify-between">
            <span className="text-[11px] uppercase tracking-wider text-slate-400 font-medium">
              Access Tier
            </span>
            <span
              className={`px-2 py-0.5 text-[10px] font-mono font-semibold rounded border ${roleBadgeColor}`}
            >
              {session.role}
            </span>
          </div>
          {session.role === 'SUPPORT' && (
            <p className="mt-1.5 text-[11px] text-slate-400">
              Read-only support mode. Balance &amp; wallet mutations are disabled.
            </p>
          )}
        </div>

        {/* Navigation Links */}
        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          {visibleNavItems.map((item) => {
            const Icon = item.icon;
            const isActive =
              item.href === '/admin'
                ? pathname === '/admin'
                : item.href === '/admin/settings'
                ? pathname === '/admin/settings'
                : pathname === item.href || pathname.startsWith(`${item.href}/`);

            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setMobileMenuOpen(false)}
                className={`flex items-center justify-between px-3 py-2.5 rounded-lg text-xs font-medium transition-colors ${
                  isActive
                    ? 'bg-indigo-500/15 text-indigo-300 border border-indigo-500/30'
                    : 'text-slate-400 hover:text-slate-100 hover:bg-slate-800/50 border border-transparent'
                }`}
              >
                <span className="flex items-center gap-3">
                  <Icon className="w-4 h-4 shrink-0" />
                  <span>{item.label}</span>
                </span>
                {session.role === 'SUPPORT' &&
                  (item.href === '/admin/users' ||
                    item.href === '/admin/ledger' ||
                    item.href === '/admin/trades') && (
                    <span className="text-[9px] font-mono uppercase px-1.5 py-0.5 rounded bg-slate-800 text-slate-400">
                      Read
                    </span>
                  )}
              </Link>
            );
          })}
        </nav>

        {/* Isolated Session Footer */}
        <div className="p-4 border-t border-slate-800/80 bg-[#090D16] space-y-3">
          <div className="flex items-center gap-2 text-[11px] text-slate-400">
            <Clock className="w-3.5 h-3.5 text-slate-500 shrink-0" />
            <span>Auto sign-out: 30m idle</span>
          </div>
          <div className="text-[11px] text-slate-500 font-mono truncate">
            Cookie: sb-admin-auth
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Bar with Global Search Box, Admin Name, Role, and Logout Button */}
        <header className="h-16 bg-[#0B101B]/90 backdrop-blur border-b border-slate-800/80 px-4 lg:px-8 flex items-center justify-between gap-4 sticky top-0 z-30">
          <div className="flex items-center gap-3 flex-1 max-w-xl">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              className="md:hidden p-2 rounded-lg border border-slate-800 text-slate-300 hover:text-white shrink-0"
            >
              <Menu className="w-4 h-4" />
            </button>

            {/* Global Admin User Search Box (searches by 5-digit User ID, email, display name, or UUID) */}
            <div className="relative flex-1 max-w-md" ref={searchBoxRef}>
              <form onSubmit={handleGlobalSearchSubmit} className="relative">
                <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  value={globalQuery}
                  onFocus={() => {
                    if (globalQuery.trim()) setSearchOpen(true);
                  }}
                  onChange={(e) => setGlobalQuery(e.target.value)}
                  placeholder="Global search: 5-digit User ID (e.g. 48213), email, name, UUID..."
                  className="w-full h-9 pl-9 pr-8 rounded-lg bg-[#070B12] border border-slate-800 focus:border-indigo-500 focus:outline-none text-xs text-white placeholder-slate-500"
                />
                {globalQuery && (
                  <button
                    type="button"
                    onClick={() => {
                      setGlobalQuery('');
                      setSearchResults([]);
                      setSearchOpen(false);
                    }}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </form>

              {searchOpen && globalQuery.trim().length > 0 && (
                <div className="absolute left-0 right-0 mt-1.5 rounded-xl bg-[#0D131F] border border-slate-800 shadow-2xl overflow-hidden z-50">
                  <div className="px-3 py-2 border-b border-slate-800 bg-slate-900/60 flex items-center justify-between text-[11px] text-slate-400">
                    <span>
                      {/^\d{5}$/.test(globalQuery.trim())
                        ? `Matching 5-digit User ID #${globalQuery.trim()} first`
                        : 'Server-side user search results'}
                    </span>
                    <span className="font-mono">
                      {searchLoading ? 'Searching...' : `${searchResults.length} found`}
                    </span>
                  </div>
                  <div className="max-h-72 overflow-y-auto divide-y divide-slate-800/60">
                    {searchResults.length === 0 && !searchLoading ? (
                      <div className="p-4 text-center text-xs text-slate-500">
                        No users matched &ldquo;{globalQuery.trim()}&rdquo;.
                      </div>
                    ) : (
                      searchResults.map((u) => {
                        const uNum = resolveUserNumber(u.user_number, u.id);
                        return (
                          <Link
                            key={u.id}
                            href={`/admin/users/${u.id}`}
                            onClick={() => setSearchOpen(false)}
                            className="px-3.5 py-2.5 flex items-center justify-between gap-3 hover:bg-slate-800/50 transition-colors text-xs"
                          >
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="px-1.5 py-0.5 rounded bg-indigo-500/20 border border-indigo-500/40 font-mono font-bold text-indigo-300 text-[11px]">
                                  ID: {uNum}
                                </span>
                                <span className="font-semibold text-white truncate">
                                  {u.display_name || u.name || 'Trader'}
                                </span>
                              </div>
                              <div className="text-[11px] font-mono text-slate-400 truncate mt-0.5">
                                {u.email || u.id}
                              </div>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              <span className="font-mono font-semibold text-emerald-300 text-[11px] tabular-nums">
                                {formatMoney(u.balance || 0)}
                              </span>
                              <ArrowRight className="w-3.5 h-3.5 text-slate-500" />
                            </div>
                          </Link>
                        );
                      })
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            {/* Admin Currency Selector (USDT default / NPR) */}
            <CurrencyToggleButton />

            <div className="hidden lg:block text-right">
              <div className="text-xs font-semibold text-white">
                {session.displayName}
              </div>
              <div className="text-[11px] text-slate-400 font-mono">
                {session.email}
              </div>
            </div>

            <span
              className={`hidden sm:inline-flex px-2.5 py-1 text-[10px] font-mono font-semibold rounded-md border ${roleBadgeColor}`}
            >
              {session.role}
            </span>

            <button
              type="button"
              onClick={() => handleLogout()}
              disabled={loggingOut}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 border border-rose-500/30 transition-colors cursor-pointer disabled:opacity-50"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">
                {loggingOut ? 'Signing out...' : 'Sign Out'}
              </span>
            </button>
          </div>
        </header>

        {/* Page Body */}
        <main className="flex-1 p-4 lg:p-8 overflow-x-hidden">{children}</main>
      </div>
    </div>
  );
}
