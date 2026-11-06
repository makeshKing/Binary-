export type TradeDirection = 'CALL' | 'PUT';
export type TradeStatus = 'OPEN' | 'WON' | 'LOST' | 'DRAW';
export type AdminRole = 'USER' | 'SUPPORT' | 'ADMIN' | 'SUPERADMIN';
export type UserRole = 'user' | 'admin' | AdminRole;
export type UserStatus = 'ACTIVE' | 'SUSPENDED' | 'DISABLED';
export type WalletRequestType = 'DEPOSIT' | 'WITHDRAW';
export type WalletRequestStatus = 'PENDING' | 'APPROVED' | 'REJECTED';
export type LedgerEntryType =
  | 'INITIAL_CREDIT'
  | 'TRADE_DEBIT'
  | 'TRADE_OPEN'
  | 'TRADE_PAYOUT'
  | 'TRADE_REFUND'
  | 'DEPOSIT'
  | 'WITHDRAW'
  | 'RESET'
  | 'ADJUSTMENT';

export type CurrencyCodeType = 'USDT' | 'NPR';

export interface CurrencyRow {
  code: CurrencyCodeType;
  symbol: string;
  decimals: number;
  is_active: boolean;
  display_order: number;
}

export interface ExchangeRateRow {
  id: string | number;
  base: 'USDT';
  quote: 'NPR';
  rate: number | string;
  reason: string;
  set_by: string | null;
  set_by_email?: string | null;
  set_by_name?: string | null;
  created_at: string;
}

export interface ProfileRow {
  id: string;
  user_number?: number;
  email?: string | null;
  name: string;
  display_name?: string;
  avatar_url?: string | null;
  country?: string | null;
  phone?: string | null;
  balance: number | string;
  preferred_currency?: CurrencyCodeType | null;
  role: UserRole;
  status?: UserStatus;
  is_admin?: boolean;
  last_reset_at: string | null;
  created_at: string;
}

export interface AdminAuditLogRow {
  id: string;
  admin_id: string | null;
  admin_user_id?: string | null;
  admin_email: string | null;
  admin_user_number?: number | null;
  target_user_number?: number | null;
  target_user_id?: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  ip_address: string | null;
  user_agent: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface WalletRequestRow {
  id: string;
  user_id: string;
  user_number?: number | null;
  user_email?: string | null;
  user_display_name?: string | null;
  user_balance?: number | string | null;
  type: WalletRequestType;
  amount: number | string;
  status: WalletRequestStatus;
  note: string | null;
  admin_note: string | null;
  created_at: string;
  reviewed_at: string | null;
  reviewed_by: string | null;
}

export interface UserNotificationRow {
  id: string;
  user_id: string;
  user_number?: number | null;
  request_id?: string | null;
  type:
    | 'DEPOSIT_APPROVED'
    | 'DEPOSIT_REJECTED'
    | 'WITHDRAW_APPROVED'
    | 'WITHDRAW_REJECTED'
    | 'REQUEST_APPROVED'
    | 'REQUEST_REJECTED'
    | 'BALANCE_ADJUSTED'
    | 'SYSTEM'
    | 'INFO';
  title: string;
  message: string;
  is_read: boolean;
  created_at: string;
}

export interface AssetRow {
  id: string;
  symbol: string;
  name: string;
  volatility: number | string;
  payout_percent: number;
  payout_rate?: number | string;
  anchor_price?: number | string;
  is_active: boolean;
  created_at?: string;
}

export interface PriceTickRow {
  id: number;
  asset_id: string;
  price: number | string;
  created_at: string;
}

export interface TradeRow {
  id: string;
  user_id: string;
  user_number?: number | null;
  user_email?: string | null;
  user_display_name?: string | null;
  asset_id: string;
  symbol?: string;
  direction: TradeDirection;
  amount: number | string;
  stake?: number | string;
  entry_price: number | string;
  exit_price: number | string | null;
  payout_percent: number;
  payout?: number | string | null;
  opened_at: string;
  expires_at: string;
  status: TradeStatus;
  profit: number | string | null;
  display_currency?: CurrencyCodeType | null;
  fx_rate_used?: number | string | null;
}

export interface BalanceLedgerRow {
  id: string;
  user_id: string;
  user_number?: number | null;
  user_email?: string | null;
  user_display_name?: string | null;
  trade_id: string | null;
  type: LedgerEntryType;
  entry_type?: LedgerEntryType;
  amount: number | string;
  delta?: number | string;
  note?: string | null;
  balance_after: number | string;
  created_at: string;
}

export interface LeaderboardRow {
  rank: number;
  user_id: string;
  trader_name: string;
  settled_trades: number;
  total_volume: number | string;
  total_profit: number | string;
  current_balance: number | string;
}

/**
 * Resolves a real authenticated user's 5-digit User ID (10000..99999).
 * Never returns a hardcoded guest ID when no user is authenticated.
 */
export function resolveUserNumber(
  userNumber?: number | null,
  authenticatedUserId?: string | null
): number {
  if (
    typeof userNumber === 'number' &&
    Number.isFinite(userNumber) &&
    userNumber >= 10000 &&
    userNumber <= 99999
  ) {
    return Math.floor(userNumber);
  }
  if (!authenticatedUserId) {
    return 0;
  }
  let hash = 0;
  for (let i = 0; i < authenticatedUserId.length; i++) {
    hash = (hash * 31 + authenticatedUserId.charCodeAt(i)) >>> 0;
  }
  return 10000 + (hash % 90000);
}

declare global {
  interface Window {
    __SUPABASE_CONFIG__?: {
      url?: string;
      anonKey?: string;
    };
  }
}

export function getSupabaseConfig(): { url: string; anonKey: string } {
  if (typeof window !== 'undefined' && window.__SUPABASE_CONFIG__) {
    const winUrl = window.__SUPABASE_CONFIG__.url?.trim() || '';
    const winKey = window.__SUPABASE_CONFIG__.anonKey?.trim() || '';
    if (winUrl && winKey) {
      return { url: winUrl, anonKey: winKey };
    }
  }

  const url = (
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.SUPABASE_URL ||
    ''
  ).trim();
  const anonKey = (
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    ''
  ).trim();

  return { url, anonKey };
}

export function isSupabaseConfigured(): boolean {
  const { url, anonKey } = getSupabaseConfig();
  return Boolean(
    url &&
      anonKey &&
      url.startsWith('http') &&
      !url.includes('your-project-ref.supabase.co') &&
      !url.includes('placeholder-project.supabase.co') &&
      anonKey !== 'your-supabase-anon-public-key'
  );
}
