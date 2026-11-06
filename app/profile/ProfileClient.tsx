'use client';

import React, { useEffect, useState, useCallback, useRef } from 'react';
import Link from 'next/link';
import {
  User,
  Globe,
  Phone,
  Upload,
  BarChart3,
  Trophy,
  Wallet,
  ArrowLeft,
  Save,
  TrendingUp,
  Award,
  Activity,
  Camera,
  Copy,
  Check,
  LogOut,
  Loader2,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import {
  isSupabaseConfigured,
  ProfileRow,
  resolveUserNumber,
  TradeRow,
} from '@/lib/supabase/types';
import {
  performFullLogout,
  useProtectedSessionGuard,
} from '@/lib/supabase/auth-utils';
import { ToastBanner } from '@/components/BalanceBadge';
import {
  CurrencyToggleButton,
  useCurrency,
} from '@/components/CurrencyProvider';

const COUNTRIES = [
  'United States',
  'United Kingdom',
  'Canada',
  'Australia',
  'Germany',
  'France',
  'India',
  'Singapore',
  'Japan',
  'Brazil',
  'United Arab Emirates',
  'Switzerland',
  'Netherlands',
  'Spain',
  'South Korea',
];

export default function ProfilePage() {
  const configured = isSupabaseConfigured();
  const { formatMoney, isFading } = useCurrency();
  const { isCheckingAuth, authenticatedUserId, userEmail: sessionEmail } =
    useProtectedSessionGuard('/profile');
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [userId, setUserId] = useState<string | null>(null);
  const [userNumber, setUserNumber] = useState<number | null>(null);
  const [copiedId, setCopiedId] = useState<boolean>(false);
  const [userEmail, setUserEmail] = useState<string>('');
  const [displayName, setDisplayName] = useState<string>('');
  const [country, setCountry] = useState<string>('United States');
  const [phone, setPhone] = useState<string>('');
  const [avatarUrl, setAvatarUrl] = useState<string>('');
  const [balance, setBalance] = useState<number>(0);
  const [createdAt, setCreatedAt] = useState<string>('');

  const [totalTrades, setTotalTrades] = useState<number>(0);
  const [wonTrades, setWonTrades] = useState<number>(0);
  const [settledTrades, setSettledTrades] = useState<number>(0);
  const [totalProfit, setTotalProfit] = useState<number>(0);

  const [loading, setLoading] = useState<boolean>(true);
  const [saving, setSaving] = useState<boolean>(false);
  const [uploadingAvatar, setUploadingAvatar] = useState<boolean>(false);
  const [loggingOut, setLoggingOut] = useState<boolean>(false);
  const [toast, setToast] = useState<{
    type: 'success' | 'error' | 'info';
    message: string;
  } | null>(null);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4500);
    return () => clearTimeout(t);
  }, [toast]);

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
    setTotalTrades(0);
    setWonTrades(0);
    setSettledTrades(0);
    setTotalProfit(0);
    await performFullLogout('logged_out');
  };

  const loadProfileAndStats = useCallback(async () => {
    if (!configured || !authenticatedUserId) {
      return;
    }

    try {
      const supabase = createClient();
      setUserId(authenticatedUserId);
      setUserEmail(sessionEmail || '');

      let { data: profileData } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', authenticatedUserId)
        .maybeSingle();

      // Immediate post-registration retry so user_number appears right after signup without refresh
      if (!profileData) {
        await new Promise((r) => setTimeout(r, 250));
        const retryRes = await supabase
          .from('profiles')
          .select('*')
          .eq('id', authenticatedUserId)
          .maybeSingle();
        profileData = retryRes.data;
      }

      if (profileData) {
        const p = profileData as ProfileRow;
        setUserNumber(resolveUserNumber(p.user_number, authenticatedUserId));
        setDisplayName(p.display_name || p.name || 'Trader');
        setCountry(p.country || 'United States');
        setPhone(p.phone || '');
        setAvatarUrl(p.avatar_url || '');
        setBalance(Number(p.balance));
        setCreatedAt(p.created_at || '');
        if (p.email) setUserEmail(p.email);
      } else {
        setUserNumber(resolveUserNumber(null, authenticatedUserId));
      }

      const { data: tradesData } = await supabase
        .from('trades')
        .select('id, status, profit')
        .eq('user_id', authenticatedUserId);

      if (tradesData) {
        const rows = tradesData as Pick<TradeRow, 'id' | 'status' | 'profit'>[];
        const total = rows.length;
        const settled = rows.filter((t) =>
          ['WON', 'LOST', 'DRAW'].includes(t.status)
        );
        const wins = settled.filter((t) => t.status === 'WON').length;
        const profitSum = settled.reduce(
          (acc, r) => acc + Number(r.profit ?? 0),
          0
        );

        setTotalTrades(total);
        setSettledTrades(settled.length);
        setWonTrades(wins);
        setTotalProfit(Number(profitSum.toFixed(2)));
      }
    } catch (err) {
      console.error('Failed to load profile:', err);
    } finally {
      setLoading(false);
    }
  }, [configured, authenticatedUserId, sessionEmail]);

  useEffect(() => {
    if (!isCheckingAuth && authenticatedUserId) {
      void loadProfileAndStats();
    }
  }, [isCheckingAuth, authenticatedUserId, loadProfileAndStats]);

  // Realtime subscription on profile and trades
  useEffect(() => {
    if (!configured || !userId) return;

    const supabase = createClient();
    const channelId = `profile_page_${userId}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

    const channel = supabase
      .channel(channelId)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'profiles',
          filter: `id=eq.${userId}`,
        },
        (payload) => {
          const updated = payload.new as ProfileRow;
          if (!updated) return;
          if (updated.user_number !== undefined && updated.user_number !== null) {
            setUserNumber(Number(updated.user_number));
          }
          if (updated.balance !== undefined) {
            setBalance(Number(updated.balance));
          }
          if (updated.display_name || updated.name) {
            setDisplayName(updated.display_name || updated.name);
          }
          if (updated.country) {
            setCountry(updated.country);
          }
          if (updated.avatar_url !== undefined) {
            setAvatarUrl(updated.avatar_url || '');
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
        () => {
          void loadProfileAndStats();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [configured, userId, loadProfileAndStats]);

  async function handleAvatarFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      setToast({
        type: 'error',
        message: 'Please select a valid image file (PNG, JPEG, WebP, or GIF).',
      });
      return;
    }

    if (file.size > 2 * 1024 * 1024) {
      setToast({
        type: 'error',
        message: 'Avatar file size must be 2 MB or less.',
      });
      return;
    }

    if (!configured || !userId) {
      setToast({
        type: 'error',
        message: 'You must be signed in to upload an avatar.',
      });
      return;
    }

    setUploadingAvatar(true);
    try {
      const supabase = createClient();
      const ext = file.name.split('.').pop()?.toLowerCase() || 'png';
      const filePath = `${userId}/avatar-${Date.now()}.${ext}`;

      const { error: uploadError } = await supabase.storage
        .from('avatars')
        .upload(filePath, file, {
          cacheControl: '3600',
          upsert: true,
        });

      if (uploadError) {
        setToast({
          type: 'error',
          message: `Storage upload error: ${uploadError.message}`,
        });
        return;
      }

      const {
        data: { publicUrl },
      } = supabase.storage.from('avatars').getPublicUrl(filePath);

      setAvatarUrl(publicUrl);

      const { error: rpcError } = await supabase.rpc('update_profile', {
        p_display_name: displayName.trim() || 'Trader',
        p_country: country.trim() || 'United States',
        p_avatar_url: publicUrl,
        p_phone: phone.trim() || null,
      });

      if (rpcError) {
        setToast({
          type: 'error',
          message: rpcError.message,
        });
      } else {
        setToast({
          type: 'success',
          message: 'Avatar uploaded to your private folder in "avatars" bucket and saved.',
        });
      }
    } catch {
      setToast({
        type: 'error',
        message: 'Unexpected error while uploading avatar.',
      });
    } finally {
      setUploadingAvatar(false);
    }
  }

  async function handleSaveProfile(e: React.FormEvent) {
    e.preventDefault();
    const trimmedName = displayName.trim();

    if (trimmedName.length < 2 || trimmedName.length > 50) {
      setToast({
        type: 'error',
        message: 'Display name must be between 2 and 50 characters.',
      });
      return;
    }

    if (!configured || !userId) {
      setToast({
        type: 'error',
        message: 'You must be signed in to update your profile.',
      });
      return;
    }

    setSaving(true);
    try {
      const supabase = createClient();
      const { data, error } = await supabase.rpc('update_profile', {
        p_display_name: trimmedName,
        p_country: country.trim() || null,
        p_avatar_url: avatarUrl.trim() || null,
        p_phone: phone.trim() || null,
      });

      if (error) {
        setToast({
          type: 'error',
          message: error.message || 'Failed to update profile.',
        });
      } else {
        const updated = data as ProfileRow | null;
        if (updated) {
          setDisplayName(updated.display_name || updated.name);
          setCountry(updated.country || 'United States');
          setPhone(updated.phone || '');
          setAvatarUrl(updated.avatar_url || '');
        }
        setToast({
          type: 'success',
          message: 'Profile updated via update_profile() RPC.',
        });
      }
    } catch {
      setToast({
        type: 'error',
        message: 'Network error while updating profile.',
      });
    } finally {
      setSaving(false);
    }
  }

  if (isCheckingAuth || !authenticatedUserId) {
    return (
      <div className="flex-1 bg-[#171a23] text-slate-100 flex items-center justify-center p-6">
        <div className="flex items-center gap-2.5 text-xs text-[#8c94ab]">
          <Loader2 className="w-4 h-4 animate-spin text-[#3898ff]" />
          <span>Verifying authenticated session...</span>
        </div>
      </div>
    );
  }

  const winRate =
    settledTrades > 0
      ? Number(((wonTrades / settledTrades) * 100).toFixed(1))
      : 0;

  return (
    <div className="flex-1 bg-[#171a23] text-slate-100 flex flex-col">
      {/* Top Navigation Header */}
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
            <User className="w-4 h-4 text-[#3898ff]" />
            <h1 className="text-sm font-bold text-white truncate">
              Trader Profile &amp; Performance
            </h1>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-5xl w-full mx-auto p-4 sm:p-6 space-y-6">
        {/* Live Account Balance Bar */}
        <div className="bg-[#1c2233] border border-[#2e3852] rounded-xl px-4 py-3 flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="flex items-center gap-2 text-slate-200 font-semibold">
            <BarChart3 className="w-4 h-4 text-[#22ab68] shrink-0" />
            <span>Live Trading Account · Verified Performance</span>
          </div>
          <div className="text-[#8c94ab] font-mono">
            Live Account Balance:{' '}
            <span
              className={`text-white font-bold tabular-nums transition-opacity duration-150 ${
                isFading ? 'opacity-30' : 'opacity-100'
              }`}
            >
              {formatMoney(balance)}
            </span>
          </div>
        </div>

        {/* Account Performance Stats Grid */}
        <section
          aria-label="Account trading statistics"
          className="grid grid-cols-1 sm:grid-cols-3 gap-4"
        >
          <div className="bg-[#1c202b] border border-[#2e3446] rounded-xl p-5 flex flex-col justify-between">
            <div className="flex items-center justify-between text-xs text-[#8c94ab]">
              <span>Total Trades</span>
              <Activity className="w-4 h-4 text-[#3898ff]" />
            </div>
            <div className="mt-3">
              <div className="text-2xl font-extrabold font-mono text-white tabular-nums">
                {loading ? '—' : totalTrades}
              </div>
              <p className="text-xs text-[#7c849b] mt-1">
                {settledTrades} settled · {Math.max(0, totalTrades - settledTrades)} open
              </p>
            </div>
          </div>

          <div className="bg-[#1c202b] border border-[#2e3446] rounded-xl p-5 flex flex-col justify-between">
            <div className="flex items-center justify-between text-xs text-[#8c94ab]">
              <span>Win Rate</span>
              <Award className="w-4 h-4 text-[#f59e0b]" />
            </div>
            <div className="mt-3">
              <div className="text-2xl font-extrabold font-mono text-white tabular-nums">
                {loading ? '—' : `${winRate}%`}
              </div>
              <p className="text-xs text-[#7c849b] mt-1">
                {wonTrades} won out of {settledTrades} settled trades
              </p>
            </div>
          </div>

          <div className="bg-[#1c202b] border border-[#2e3446] rounded-xl p-5 flex flex-col justify-between">
            <div className="flex items-center justify-between text-xs text-[#8c94ab]">
              <span>Total Net Profit</span>
              <TrendingUp className="w-4 h-4 text-[#22ab68]" />
            </div>
            <div className="mt-3">
              <div
                className={`text-2xl font-extrabold font-mono tabular-nums transition-opacity duration-150 ${
                  isFading ? 'opacity-30' : 'opacity-100'
                } ${
                  totalProfit >= 0 ? 'text-[#22ab68]' : 'text-[#e34c3b]'
                }`}
              >
                {loading
                  ? '—'
                  : formatMoney(totalProfit, {
                      showPlusSign: totalProfit > 0,
                    })}
              </div>
              <p className="text-xs text-[#7c849b] mt-1">
                Lifetime P&amp;L across settled positions
              </p>
            </div>
          </div>
        </section>

        {/* Profile Form & Avatar Upload Card */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Left: Avatar Upload Card */}
          <section className="lg:col-span-4 bg-[#1c202b] border border-[#2e3446] rounded-xl p-6 flex flex-col items-center text-center justify-between">
            <div className="w-full flex flex-col items-center">
              <div className="relative group">
                {avatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={avatarUrl}
                    alt={displayName}
                    referrerPolicy="no-referrer"
                    className="w-24 h-24 rounded-full object-cover border-2 border-[#3898ff] bg-[#141722]"
                  />
                ) : (
                  <div className="w-24 h-24 rounded-full bg-[#252a3a] border-2 border-[#363d52] flex items-center justify-center text-2xl font-extrabold text-[#3898ff]">
                    {(displayName || 'T').slice(0, 2).toUpperCase()}
                  </div>
                )}

                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploadingAvatar}
                  title="Upload Avatar Image"
                  className="absolute bottom-0 right-0 w-9 h-9 rounded-full bg-[#1d8cf8] hover:bg-[#1779db] text-white flex items-center justify-center shadow-lg cursor-pointer"
                >
                  <Camera className="w-4 h-4" />
                </button>
              </div>

              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                onChange={handleAvatarFileChange}
                className="hidden"
              />

              <h2 className="mt-4 text-base font-bold text-white">
                {displayName || 'Trader'}
              </h2>

              {/* 5-Digit Immutable User ID directly below profile name/avatar */}
              <div className="mt-2 inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[#141722] border border-[#2e3446]">
                <span className="text-xs font-mono font-bold text-white">
                  User ID:{' '}
                  <span className="text-[#3898ff]">{userNumber ?? '—'}</span>
                </span>
                {userNumber && (
                  <button
                    type="button"
                    onClick={handleCopyUserNumber}
                    title="Copy 5-Digit User ID"
                    className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-[#252a3a] hover:bg-[#31384d] text-[10px] font-bold text-slate-200 transition-colors cursor-pointer"
                  >
                    {copiedId ? (
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
                )}
              </div>

              <p className="text-xs text-[#8c94ab] mt-2">{userEmail}</p>
              <p className="text-xs text-[#7c849b] mt-1">
                {country || 'United States'}
                {createdAt
                  ? ` · Joined ${new Date(createdAt).toLocaleDateString()}`
                  : ''}
              </p>
            </div>

            <div className="w-full mt-6 pt-5 border-t border-[#262b38] space-y-2.5">
              <button
                type="button"
                disabled={uploadingAvatar}
                onClick={() => fileInputRef.current?.click()}
                className="min-h-[42px] w-full py-2 px-4 rounded-lg bg-[#252a3a] hover:bg-[#2e3446] border border-[#343b4f] text-xs font-bold text-white flex items-center justify-center gap-2 transition-colors cursor-pointer disabled:opacity-50"
              >
                <Upload className="w-4 h-4 text-[#3898ff]" />
                <span>
                  {uploadingAvatar
                    ? 'Uploading to avatars bucket...'
                    : 'Upload Avatar Image'}
                </span>
              </button>

              <button
                type="button"
                disabled={loggingOut}
                onClick={handleLogout}
                className="min-h-[42px] w-full py-2 px-4 rounded-lg bg-[#e34c3b]/15 hover:bg-[#e34c3b]/25 border border-[#e34c3b]/40 text-xs font-bold text-red-200 hover:text-white flex items-center justify-center gap-2 transition-colors cursor-pointer disabled:opacity-50"
              >
                <LogOut className="w-4 h-4 text-[#e34c3b]" />
                <span>{loggingOut ? 'Logging out...' : 'Log Out of Account'}</span>
              </button>
            </div>
          </section>

          {/* Right: Edit Profile Form */}
          <section className="lg:col-span-8 bg-[#1c202b] border border-[#2e3446] rounded-xl p-6">
            <div className="pb-4 border-b border-[#262b38]">
              <h2 className="text-base font-bold text-white">
                Personal Profile Settings
              </h2>
              <p className="text-xs text-[#8c94ab] mt-1">
                Updates are validated and executed through the server-side{' '}
                <code className="text-slate-300">update_profile()</code> RPC. Balance and admin privileges cannot be modified by clients.
              </p>
            </div>

            <form onSubmit={handleSaveProfile} className="mt-5 space-y-4">
              <div>
                <label
                  htmlFor="display-name-input"
                  className="block text-xs font-semibold text-slate-300 mb-1.5"
                >
                  Display Name
                </label>
                <div className="relative">
                  <User className="w-4 h-4 text-[#7c849b] absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    id="display-name-input"
                    type="text"
                    required
                    minLength={2}
                    maxLength={50}
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder="Enter your trader display name"
                    className="w-full h-11 pl-10 pr-4 rounded-lg bg-[#141722] border border-[#2e3446] focus:border-[#3898ff] focus:outline-none text-sm text-white"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label
                    htmlFor="country-select"
                    className="block text-xs font-semibold text-slate-300 mb-1.5"
                  >
                    Country / Region
                  </label>
                  <div className="relative">
                    <Globe className="w-4 h-4 text-[#7c849b] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <select
                      id="country-select"
                      value={country}
                      onChange={(e) => setCountry(e.target.value)}
                      className="w-full h-11 pl-10 pr-4 rounded-lg bg-[#141722] border border-[#2e3446] focus:border-[#3898ff] focus:outline-none text-sm text-white"
                    >
                      {COUNTRIES.map((c) => (
                        <option key={c} value={c} className="bg-[#141722]">
                          {c}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div>
                  <label
                    htmlFor="phone-input"
                    className="block text-xs font-semibold text-slate-300 mb-1.5"
                  >
                    Phone (Optional)
                  </label>
                  <div className="relative">
                    <Phone className="w-4 h-4 text-[#7c849b] absolute left-3.5 top-1/2 -translate-y-1/2" />
                    <input
                      id="phone-input"
                      type="tel"
                      maxLength={32}
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      placeholder="+1 555 0100 (Optional)"
                      className="w-full h-11 pl-10 pr-4 rounded-lg bg-[#141722] border border-[#2e3446] focus:border-[#3898ff] focus:outline-none text-sm text-white"
                    />
                  </div>
                </div>
              </div>

              <div>
                <label
                  htmlFor="avatar-url-input"
                  className="block text-xs font-semibold text-slate-300 mb-1.5"
                >
                  Avatar URL (Auto-filled on upload or enter image URL)
                </label>
                <input
                  id="avatar-url-input"
                  type="url"
                  maxLength={500}
                  value={avatarUrl}
                  onChange={(e) => setAvatarUrl(e.target.value)}
                  placeholder="https://your-project.supabase.co/storage/v1/object/public/avatars/..."
                  className="w-full h-11 px-3.5 rounded-lg bg-[#141722] border border-[#2e3446] focus:border-[#3898ff] focus:outline-none text-xs font-mono text-slate-200"
                />
              </div>

              <div className="pt-2 flex flex-wrap items-center justify-between gap-3">
                <Link
                  href="/wallet"
                  prefetch={false}
                  className="min-h-[42px] px-4 py-2 rounded-lg bg-[#252a3a] hover:bg-[#2e3446] text-xs font-bold text-slate-200 flex items-center gap-2 transition-colors"
                >
                  <Wallet className="w-4 h-4 text-[#22ab68]" />
                  <span>Open Account Wallet</span>
                </Link>

                <button
                  type="submit"
                  disabled={saving}
                  className="min-h-[42px] px-6 py-2 rounded-lg bg-[#22ab68] hover:bg-[#1e995d] disabled:opacity-50 text-xs font-bold text-white flex items-center justify-center gap-2 transition-colors cursor-pointer"
                >
                  <Save className="w-4 h-4" />
                  <span>{saving ? 'Saving Profile...' : 'Save Profile Changes'}</span>
                </button>
              </div>
            </form>
          </section>
        </div>
      </main>

      <ToastBanner toast={toast} onDismiss={() => setToast(null)} />
    </div>
  );
}
