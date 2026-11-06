'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  ArrowRight,
  ArrowUp,
  ArrowDown,
  Award,
  BarChart2,
  Bell,
  BookOpen,
  CheckCircle2,
  ChevronDown,
  Clock,
  Compass,
  CreditCard,
  DollarSign,
  Flame,
  Gift,
  Globe,
  Headphones,
  HelpCircle,
  LayoutGrid,
  LineChart,
  Lock,
  Maximize2,
  Menu,
  MessageSquare,
  Minus,
  Monitor,
  Play,
  Pause,
  Plus,
  Radio,
  RefreshCw,
  Settings,
  Shield,
  Sliders,
  Smartphone,
  Star,
  TrendingUp,
  Trophy,
  User,
  Volume2,
  Wallet,
  Zap,
} from 'lucide-react';

interface Candle {
  id: number;
  time: string;
  open: number;
  close: number;
  high: number;
  low: number;
}

const INITIAL_CANDLES: Candle[] = [
  { id: 1, time: '14:08', open: 44.0, close: 43.9985, high: 44.0005, low: 43.9975 },
  { id: 2, time: '14:10', open: 43.9985, close: 43.9942, high: 43.999, low: 43.9935 },
  { id: 3, time: '14:12', open: 43.9942, close: 43.9968, high: 43.9975, low: 43.9938 },
  { id: 4, time: '14:14', open: 43.9968, close: 43.9932, high: 43.9972, low: 43.9922 },
  { id: 5, time: '14:16', open: 43.9932, close: 43.9976, high: 43.9982, low: 43.9928 },
  { id: 6, time: '14:18', open: 43.9976, close: 43.9998, high: 44.0012, low: 43.9971 },
  { id: 7, time: '14:20', open: 43.9998, close: 43.9965, high: 44.0004, low: 43.9958 },
  { id: 8, time: '14:22', open: 43.9965, close: 43.9982, high: 43.999, low: 43.9955 },
  { id: 9, time: '14:24', open: 43.9982, close: 44.0005, high: 44.0018, low: 43.9978 },
  { id: 10, time: '14:26', open: 44.0005, close: 44.0018, high: 44.0028, low: 43.9998 },
  { id: 11, time: '14:28', open: 44.0018, close: 44.0002, high: 44.0024, low: 43.9992 },
  { id: 12, time: '14:30', open: 44.0002, close: 43.9978, high: 44.0008, low: 43.997 },
  { id: 13, time: '14:32', open: 43.9978, close: 43.9989, high: 43.9996, low: 43.9972 },
  { id: 14, time: '14:34', open: 43.9989, close: 43.9955, high: 43.9992, low: 43.9945 },
  { id: 15, time: '14:36', open: 43.9955, close: 43.992, high: 43.996, low: 43.9912 },
];

const REVIEWS = [
  {
    name: 'Rahima',
    date: '29.01.2025',
    earned: '$8400',
    shortText:
      'As a beginner, I really appreciated the demo account. It let me experiment with different indicators and strategies without the fear of...',
    fullText:
      'As a beginner, I really appreciated the demo account. It let me experiment with different indicators and strategies without the fear of losing real capital. Once I switched to my live account, payouts and withdrawals were fast and reliable.',
  },
  {
    name: 'Terwase',
    date: '03.12.2024',
    earned: '$913',
    shortText:
      'The interface is easy and simple to understand and use. The proximity ratio for placing an up or down trade/buy or sell ratio is 1:1. The app work...',
    fullText:
      'The interface is easy and simple to understand and use. The proximity ratio for placing an up or down trade/buy or sell ratio is 1:1. The app works smoothly with zero lag during volatile market sessions.',
  },
  {
    name: 'Abhi',
    date: '28.11.2024',
    earned: '$1041',
    shortText:
      'Quotex is a great trading platform. Previously, I tried some trading apps, but now that I have found Quotex, I am sticking to it. Moreover, their...',
    fullText:
      'Quotex is a great trading platform. Previously, I tried some trading apps, but now that I have found Quotex, I am sticking to it. Moreover, their integrated signals and instant chart execution make daily trading much more consistent.',
  },
  {
    name: 'Sonal',
    date: '25.11.2024',
    earned: '$398',
    shortText:
      "I've had nothing but positive experiences with Quotex over the years that I've been using it. The platform's intuitive and user-friendly design...",
    fullText:
      "I've had nothing but positive experiences with Quotex over the years that I've been using it. The platform's intuitive and user-friendly design makes managing my wallet and executing short-term trades effortless.",
  },
  {
    name: 'Md Imran',
    date: '24.11.2024',
    earned: '$217',
    shortText:
      "In binary trading, Quotex is very good for me! The broker's deposit and withdrawal system is very good. Best regards, Quotex broker from me. 💜💜",
    fullText:
      "In binary trading, Quotex is very good for me! The broker's deposit and withdrawal system is very good. Best regards, Quotex broker from me. 💜💜",
  },
  {
    name: 'Shree Ganesh',
    date: '01.11.2024',
    earned: '$379',
    shortText:
      "I've been using Quotex for some time now, and the experience has been excellent. The platform is straightforward to navigate, with a clean and...",
    fullText:
      "I've been using Quotex for some time now, and the experience has been excellent. The platform is straightforward to navigate, with a clean and responsive candlestick chart and transparent trade history.",
  },
];

const FAQS = [
  {
    q: 'How do I learn how to trade?',
    a: 'Sign up and practice on the free demo account loaded with 10,000 USD in virtual funds. You can test technical indicators, chart timeframes, and integrated signals before switching to your live balance.',
  },
  {
    q: 'How long does it take to withdraw funds?',
    a: 'Withdrawal requests are processed promptly by our financial operations team. Most e-wallet and crypto withdrawals complete within a few hours to 1–3 business days depending on your selected payment method.',
  },
  {
    q: 'What is trading platform and what it is for?',
    a: 'QUOTEX is a digital web trading terminal where traders forecast short-term price movements on currency pairs, cryptocurrencies, commodities, and OTC indices with fixed payout percentages up to 93%.',
  },
  {
    q: 'Can I trade using a phone / mobile device?',
    a: 'Yes! Our web trading terminal is fully optimized as a responsive Progressive Web App (PWA) and mobile platform, allowing you to monitor charts and place CALL/PUT trades from any smartphone or tablet.',
  },
  {
    q: 'What is the minimum deposit amount?',
    a: 'The minimum deposit amount to start real live trading is only 10 USD, with minimum individual trade investments starting from 1 USD.',
  },
  {
    q: 'Are there any deposit or withdrawal fees?',
    a: 'QUOTEX does not charge any internal commission or platform fees on deposits or withdrawals. Third-party payment providers or blockchain networks may apply their standard network fee.',
  },
];

export function LandingUsagePage() {
  // Animated Hero Terminal Video State
  const [candles, setCandles] = useState<Candle[]>(INITIAL_CANDLES);
  const [isPlayingVideo, setIsPlayingVideo] = useState(true);
  const [activePairIdx, setActivePairIdx] = useState(2); // USD/EGP (OTC) 93%
  const [investment, setInvestment] = useState(15);
  const [countdown, setCountdown] = useState(15);
  const [liveBalance, setLiveBalance] = useState(12785.51);
  const [sentimentUp, setSentimentUp] = useState(73);
  const [activeDirection, setActiveDirection] = useState<'UP' | 'DOWN'>('UP');
  const [recentWinFlash, setRecentWinFlash] = useState(false);

  // Page UI State
  const [expandedReviews, setExpandedReviews] = useState<Record<number, boolean>>({});
  const [openFaqIdx, setOpenFaqIdx] = useState<number | null>(0);
  const [langOpen, setLangOpen] = useState(false);
  const [selectedLang, setSelectedLang] = useState('EN');
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  // Continuous live video animation loop for the Hero Trading Terminal
  useEffect(() => {
    if (!isPlayingVideo) return;

    let stepCount = 0;

    const interval = setInterval(() => {
      stepCount += 1;
      const isRollover = stepCount % 15 === 0;

      setCountdown(15 - (stepCount % 15));

      setSentimentUp((prev) => {
        const step = Math.random() > 0.5 ? 1 : -1;
        return Math.max(62, Math.min(84, prev + step));
      });

      if (isRollover) {
        setRecentWinFlash(true);
        setLiveBalance((b) => Number((b + 13.95).toFixed(2)));
        setTimeout(() => setRecentWinFlash(false), 1100);

        setCandles((oldCandles) => {
          const last = oldCandles[oldCandles.length - 1];
          const nextId = (last?.id ?? oldCandles.length) + 1;
          const nextOpen = last ? last.close : 43.996;
          const drift = (Math.random() - 0.45) * 0.0022;
          const nextClose = Number(
            Math.max(43.9918, Math.min(44.002, nextOpen + drift)).toFixed(4)
          );
          const newCandle: Candle = {
            id: nextId,
            time: '14:38',
            open: nextOpen,
            close: nextClose,
            high: Math.max(nextOpen, nextClose) + 0.0006,
            low: Math.min(nextOpen, nextClose) - 0.0006,
          };
          return [...oldCandles.slice(1), newCandle];
        });
      } else {
        setCandles((prev) => {
          const next = [...prev];
          const last = { ...next[next.length - 1] };
          const delta = (Math.random() - 0.48) * 0.0014;
          const newClose = Number(
            Math.max(43.9912, Math.min(44.0025, last.close + delta)).toFixed(4)
          );
          last.close = newClose;
          last.high = Math.max(last.high, newClose + 0.0004);
          last.low = Math.min(last.low, newClose - 0.0004);
          next[next.length - 1] = last;
          return next;
        });
      }
    }, 900);

    return () => clearInterval(interval);
  }, [isPlayingVideo]);

  const currentPrice = candles[candles.length - 1]?.close ?? 43.992;
  const minPrice = 43.991;
  const maxPrice = 44.003;
  const priceToY = (p: number) => {
    const ratio = (p - minPrice) / (maxPrice - minPrice);
    return Math.max(4, Math.min(96, 100 - ratio * 100));
  };

  const pairs = [
    { symbol: 'AUD/CHF', payout: '88%', flag1: '🇦🇺', flag2: '🇨🇭' },
    { symbol: 'USD/CAD', payout: '88%', flag1: '🇺🇸', flag2: '🇨🇦' },
    { symbol: 'USD/EGP (OTC)', payout: '93%', flag1: '🇺🇸', flag2: '🇪🇬' },
  ];

  const payoutAmount = (investment * 1.93).toFixed(2);

  return (
    <div className="min-h-screen bg-[#101420] text-white font-sans antialiased selection:bg-[#0faf59]/30 selection:text-white overflow-x-hidden">
      {/* =================================================================== */}
      {/* TOP NAVIGATION BAR                                                  */}
      {/* =================================================================== */}
      <header className="sticky top-0 z-40 h-16 sm:h-20 bg-[#101420]/95 backdrop-blur-md border-b border-white/[0.05]">
        <div className="max-w-[1220px] mx-auto h-full px-3.5 sm:px-8 flex items-center justify-between gap-2">
          {/* Brand Logo */}
          <Link href="/" className="flex items-center gap-2 sm:gap-2.5 group shrink-0">
            <div className="w-8 h-8 rounded-lg bg-[#1c2336] border border-white/10 flex items-center justify-center group-hover:border-[#0faf59]/50 transition-colors">
              <Zap className="w-4 h-4 text-[#0faf59] fill-[#0faf59]" />
            </div>
            <span className="text-base sm:text-lg font-extrabold tracking-wider text-white">
              QUOTEX
            </span>
          </Link>

          {/* Center Nav Links (Desktop) */}
          <nav className="hidden md:flex items-center gap-8 text-xs font-semibold text-slate-200">
            <Link
              href="/dashboard"
              className="hover:text-[#0faf59] transition-colors"
            >
              Demo account
            </Link>
            <a
              href="#features"
              className="hover:text-[#0faf59] transition-colors"
            >
              About us
            </a>
            <a href="#faq" className="hover:text-[#0faf59] transition-colors">
              FAQ
            </a>
            <a
              href="#reviews"
              className="hover:text-[#0faf59] transition-colors"
            >
              Blog
            </a>
          </nav>

          {/* Right Auth, Language & Mobile Menu Trigger */}
          <div className="flex items-center gap-1.5 sm:gap-2.5">
            <Link
              href="/login"
              className="h-8 sm:h-9 px-2.5 sm:px-4 rounded-md bg-[#22283a] hover:bg-[#2b3349] text-[11px] sm:text-xs font-bold text-white inline-flex items-center justify-center transition-colors whitespace-nowrap"
            >
              Log in
            </Link>
            <Link
              href="/register"
              className="h-8 sm:h-9 px-2.5 sm:px-4 rounded-md bg-[#0faf59] hover:bg-[#0d9c4f] text-[11px] sm:text-xs font-bold text-white inline-flex items-center justify-center shadow-lg shadow-[#0faf59]/20 transition-colors whitespace-nowrap"
            >
              Sign up
            </Link>

            <div className="relative">
              <button
                type="button"
                onClick={() => setLangOpen((prev) => !prev)}
                className="h-8 sm:h-9 px-2 sm:px-2.5 rounded-md hover:bg-white/5 text-[11px] sm:text-xs font-semibold text-slate-300 inline-flex items-center gap-1 sm:gap-1.5 transition-colors"
              >
                <Globe className="w-3.5 h-3.5 text-slate-400" />
                <span>{selectedLang}</span>
              </button>
              {langOpen && (
                <div className="absolute right-0 mt-1.5 w-28 rounded-lg bg-[#181e2e] border border-white/10 shadow-xl py-1 z-50">
                  {['EN', 'ES', 'PT', 'HI', 'ID'].map((l) => (
                    <button
                      key={l}
                      type="button"
                      onClick={() => {
                        setSelectedLang(l);
                        setLangOpen(false);
                      }}
                      className={`w-full text-left px-3 py-1.5 text-xs font-semibold ${
                        selectedLang === l
                          ? 'bg-[#0faf59]/20 text-[#0faf59]'
                          : 'text-slate-300 hover:bg-white/5'
                      }`}
                    >
                      {l}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Mobile Hamburger Menu Button */}
            <button
              type="button"
              onClick={() => setMobileNavOpen((prev) => !prev)}
              aria-label="Toggle navigation menu"
              className="md:hidden h-8 w-8 rounded-md bg-[#1c2336] border border-white/10 text-slate-200 hover:text-white inline-flex items-center justify-center transition-colors"
            >
              <Menu className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Mobile Collapsible Navigation Drawer */}
        {mobileNavOpen && (
          <div className="md:hidden bg-[#141928] border-b border-white/10 px-4 py-4 space-y-3 shadow-2xl">
            <nav className="flex flex-col space-y-1 text-sm font-semibold text-slate-200">
              <Link
                href="/dashboard"
                onClick={() => setMobileNavOpen(false)}
                className="py-2 px-3 rounded-lg hover:bg-white/5 hover:text-[#0faf59] transition-colors"
              >
                Demo account
              </Link>
              <a
                href="#features"
                onClick={() => setMobileNavOpen(false)}
                className="py-2 px-3 rounded-lg hover:bg-white/5 hover:text-[#0faf59] transition-colors"
              >
                About us
              </a>
              <a
                href="#faq"
                onClick={() => setMobileNavOpen(false)}
                className="py-2 px-3 rounded-lg hover:bg-white/5 hover:text-[#0faf59] transition-colors"
              >
                FAQ
              </a>
              <a
                href="#reviews"
                onClick={() => setMobileNavOpen(false)}
                className="py-2 px-3 rounded-lg hover:bg-white/5 hover:text-[#0faf59] transition-colors"
              >
                Reviews
              </a>
            </nav>
            <div className="pt-2 border-t border-white/10 grid grid-cols-2 gap-2.5">
              <Link
                href="/login"
                onClick={() => setMobileNavOpen(false)}
                className="h-10 rounded-lg bg-[#22283a] hover:bg-[#2b3349] text-xs font-bold text-white inline-flex items-center justify-center transition-colors"
              >
                Log in
              </Link>
              <Link
                href="/register"
                onClick={() => setMobileNavOpen(false)}
                className="h-10 rounded-lg bg-[#0faf59] hover:bg-[#0d9c4f] text-xs font-bold text-white inline-flex items-center justify-center shadow-lg shadow-[#0faf59]/20 transition-colors"
              >
                Create account
              </Link>
            </div>
          </div>
        )}
      </header>

      {/* =================================================================== */}
      {/* HERO SECTION + LIVE ANIMATED TRADING TERMINAL VIDEO SHOWCASE        */}
      {/* =================================================================== */}
      <section className="relative pt-10 pb-14 sm:pt-20 sm:pb-28 overflow-hidden">
        {/* Background Atmospheric Candlestick & Teal/Navy Glow */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 h-[560px] bg-gradient-to-b from-[#132535]/60 via-[#101829]/80 to-[#101420]"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute top-24 right-[-10%] w-[520px] h-[320px] rounded-full bg-[#0faf59]/10 blur-[110px]"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute top-32 left-[-10%] w-[480px] h-[300px] rounded-full bg-[#2563eb]/10 blur-[110px]"
        />

        <div className="relative max-w-[1140px] mx-auto px-3.5 sm:px-6">
          {/* Hero Headline & CTA */}
          <div className="text-center max-w-2xl mx-auto">
            <h1 className="text-2xl sm:text-5xl md:text-[54px] font-extrabold tracking-tight text-white leading-[1.16] sm:leading-[1.12]">
              Innovative platform for{' '}
              <span className="sm:block">smart investments</span>
            </h1>

            <p className="mt-3.5 sm:mt-5 text-xs sm:text-base text-slate-300 font-medium px-2 sm:px-0">
              Sign up and get 10,000 USD to your demo account to learn how to
              trade.
            </p>

            <div className="mt-6 sm:mt-8 flex flex-col sm:flex-row items-center justify-center gap-3 sm:gap-5">
              <Link
                href="/register"
                className="w-full sm:w-auto h-11 sm:h-12 px-7 rounded-lg bg-[#0faf59] hover:bg-[#0d9c4f] text-sm font-bold text-white inline-flex items-center justify-center shadow-lg shadow-[#0faf59]/25 transition-all hover:scale-[1.01]"
              >
                Create a free account
              </Link>
              <p className="text-[11px] text-slate-400 max-w-[260px] sm:max-w-[230px] text-center sm:text-left leading-snug">
                * The minimum deposit amount to start real trading is 10 USD
              </p>
            </div>
          </div>

          {/* =============================================================== */}
          {/* LIVE ANIMATED VIDEO TRADING TERMINAL SHOWCASE                   */}
          {/* =============================================================== */}
          <div className="mt-8 sm:mt-14 relative rounded-xl sm:rounded-2xl bg-[#181d2c] border border-[#2a3248] shadow-[0_30px_90px_rgba(0,0,0,0.75)] overflow-hidden">
            {/* Desktop Floating Live Video Stream Control Pill */}
            <div className="hidden sm:flex absolute bottom-3 right-3 z-30 items-center gap-2 bg-[#121622]/90 backdrop-blur-md border border-white/10 rounded-lg px-2.5 py-1 text-[10px] text-slate-300">
              <span className="w-2 h-2 rounded-full bg-[#0faf59] animate-ping" />
              <span className="font-mono uppercase tracking-wider text-white font-semibold">
                LIVE TERMINAL PREVIEW
              </span>
              <button
                type="button"
                onClick={() => setIsPlayingVideo((p) => !p)}
                className="ml-1 px-1.5 py-0.5 rounded bg-white/10 hover:bg-white/20 text-white inline-flex items-center gap-1 transition-colors"
                title={isPlayingVideo ? 'Pause live preview' : 'Play live preview'}
              >
                {isPlayingVideo ? (
                  <>
                    <Pause className="w-2.5 h-2.5" />
                    <span>Pause</span>
                  </>
                ) : (
                  <>
                    <Play className="w-2.5 h-2.5" />
                    <span>Play</span>
                  </>
                )}
              </button>
            </div>

            {/* Terminal Top Header Bar */}
            <div className="h-11 sm:h-12 bg-[#1c2130] border-b border-[#283044] px-2.5 sm:px-3 flex items-center justify-between gap-2 select-none">
              {/* Left Brand & Asset Tabs */}
              <div className="flex items-center gap-2 sm:gap-3 min-w-0 overflow-x-auto no-scrollbar">
                <div className="flex items-center gap-1.5 sm:gap-2 pr-1 sm:pr-2 shrink-0">
                  <Menu className="w-4 h-4 text-slate-400 hidden sm:block" />
                  <div className="flex items-center gap-1.5">
                    <Zap className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-[#0faf59] fill-[#0faf59]" />
                    <span className="text-[11px] sm:text-xs font-extrabold tracking-wider text-white">
                      QUOTEX
                    </span>
                    <span className="hidden lg:inline text-[9px] font-mono text-slate-400 uppercase tracking-widest ml-1">
                      • WEB TRADING PLATFORM
                    </span>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() =>
                    setActivePairIdx((prev) => (prev + 1) % pairs.length)
                  }
                  className="w-6 h-6 sm:w-7 sm:h-7 rounded bg-[#2563eb] hover:bg-[#1d4ed8] text-white flex items-center justify-center shrink-0 transition-colors"
                  title="Switch market pair"
                >
                  <Plus className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
                </button>

                {/* Mobile Active Pair Pill */}
                <button
                  type="button"
                  onClick={() =>
                    setActivePairIdx((prev) => (prev + 1) % pairs.length)
                  }
                  className="sm:hidden h-7 px-2 rounded bg-[#252c40] border border-[#3a4562] text-white flex items-center gap-1.5 shrink-0"
                >
                  <span className="text-[10px] font-bold whitespace-nowrap">
                    {pairs[activePairIdx].symbol}
                  </span>
                  <span className="text-[9px] font-mono text-[#f59e0b] font-bold">
                    {pairs[activePairIdx].payout}
                  </span>
                </button>

                {/* Desktop Pair Tabs */}
                <div className="hidden sm:flex items-center gap-1.5">
                  {pairs.map((p, idx) => (
                    <button
                      key={p.symbol}
                      type="button"
                      onClick={() => setActivePairIdx(idx)}
                      className={`h-8 px-2.5 rounded-md border text-left flex items-center gap-2 transition-colors ${
                        activePairIdx === idx
                          ? 'bg-[#252c40] border-[#3a4562] text-white'
                          : 'bg-[#171c29] border-transparent text-slate-400 hover:text-white'
                      }`}
                    >
                      <span className="text-xs leading-none">
                        {p.flag1}
                        {p.flag2}
                      </span>
                      <div className="leading-tight">
                        <div className="text-[10px] font-bold whitespace-nowrap">
                          {p.symbol}
                        </div>
                        <div className="text-[9px] font-mono text-[#f59e0b] font-bold">
                          {p.payout}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Right Account Balance & Deposit / Withdrawal */}
              <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
                <div className="relative hidden sm:flex items-center justify-center w-7 h-7 rounded bg-[#252c40] text-slate-300">
                  <Bell className="w-3.5 h-3.5" />
                  <span className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full bg-[#ff4b55] text-[8px] font-bold text-white flex items-center justify-center">
                    1
                  </span>
                </div>

                <div
                  className={`h-7 sm:h-8 px-2 sm:px-3 rounded-md bg-[#252c40] border flex items-center gap-1.5 sm:gap-2 transition-colors ${
                    recentWinFlash
                      ? 'border-[#0faf59] bg-[#0faf59]/20'
                      : 'border-[#333c54]'
                  }`}
                >
                  <Globe className="w-3 h-3 sm:w-3.5 sm:h-3.5 text-[#0faf59] hidden xs:block" />
                  <div className="leading-none">
                    <span className="text-[7px] sm:text-[8px] font-mono uppercase text-slate-400 block">
                      LIVE ACCOUNT
                    </span>
                    <span className="text-[10px] sm:text-xs font-extrabold font-mono text-white tabular-nums">
                      ${liveBalance.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                    </span>
                  </div>
                  <ChevronDown className="w-3 h-3 text-slate-400 hidden sm:block" />
                </div>

                <Link
                  href="/wallet"
                  className="h-7 sm:h-8 px-2 sm:px-3 rounded-md bg-[#0faf59] hover:bg-[#0d9c4f] text-[10px] sm:text-[11px] font-bold text-white inline-flex items-center gap-1 transition-colors"
                >
                  <Plus className="w-3 h-3 hidden sm:inline" />
                  <span>Deposit</span>
                </Link>

                <Link
                  href="/wallet"
                  className="hidden md:inline-flex h-8 px-3 rounded-md bg-[#252c40] hover:bg-[#2f3850] text-[11px] font-bold text-white items-center transition-colors"
                >
                  Withdrawal
                </Link>
              </div>
            </div>

            {/* Terminal Main Workspace Grid */}
            <div className="grid grid-cols-12 sm:min-h-[510px] bg-[#151926]">
              {/* Left Terminal Icon Rail */}
              <div className="hidden sm:flex col-span-1 w-14 bg-[#191e2d] border-r border-[#262d40] flex-col items-center justify-between py-3 select-none">
                <div className="flex flex-col items-center gap-2.5 w-full px-1.5">
                  <Link
                    href="/dashboard"
                    className="w-full py-2 rounded-md bg-[#2563eb] text-white flex flex-col items-center justify-center gap-0.5 text-[8px] font-bold tracking-wider"
                  >
                    <TrendingUp className="w-3.5 h-3.5" />
                    <span>TRADE</span>
                  </Link>
                  <Link
                    href="/login"
                    className="w-full py-1.5 rounded-md hover:bg-white/5 text-slate-400 hover:text-white flex flex-col items-center justify-center gap-0.5 text-[8px] font-bold"
                  >
                    <HelpCircle className="w-3.5 h-3.5" />
                    <span>SUPPORT</span>
                  </Link>
                  <Link
                    href="/login"
                    className="w-full py-1.5 rounded-md hover:bg-white/5 text-slate-400 hover:text-white flex flex-col items-center justify-center gap-0.5 text-[8px] font-bold"
                  >
                    <User className="w-3.5 h-3.5" />
                    <span>ACCOUNT</span>
                  </Link>
                  <Link
                    href="/register"
                    className="relative w-full py-1.5 rounded-md hover:bg-white/5 text-slate-400 hover:text-white flex flex-col items-center justify-center gap-0.5 text-[8px] font-bold"
                  >
                    <Trophy className="w-3.5 h-3.5" />
                    <span className="text-[7px]">TOURNA-</span>
                    <span className="text-[7px] -mt-1">MENTS</span>
                    <span className="absolute top-0.5 right-1 w-3.5 h-3.5 rounded-full bg-[#3898ff] text-[8px] font-bold text-white flex items-center justify-center">
                      4
                    </span>
                  </Link>
                  <Link
                    href="/dashboard"
                    className="w-full py-1.5 rounded-md hover:bg-white/5 text-slate-400 hover:text-white flex flex-col items-center justify-center gap-0.5 text-[8px] font-bold"
                  >
                    <LayoutGrid className="w-3.5 h-3.5" />
                    <span>MARKET</span>
                  </Link>
                </div>

                <div className="flex flex-col items-center gap-2 w-full px-1.5">
                  <div className="grid grid-cols-2 gap-1 text-slate-500">
                    <Maximize2 className="w-3 h-3" />
                    <Settings className="w-3 h-3" />
                    <Volume2 className="w-3 h-3" />
                    <Sliders className="w-3 h-3" />
                  </div>
                  <Link
                    href="/register"
                    className="w-full py-1.5 rounded bg-[#0faf59] text-white flex flex-col items-center justify-center text-[8px] font-bold"
                  >
                    <span>Help</span>
                  </Link>
                </div>
              </div>

              {/* Center Live Animated Candlestick Chart Canvas */}
              <div className="col-span-12 sm:col-span-8 lg:col-span-8 min-h-[260px] sm:min-h-0 relative flex flex-col justify-between p-2.5 sm:p-4 overflow-hidden select-none">
                {/* Subtle Grid Lines */}
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-0 grid grid-cols-6 grid-rows-5"
                >
                  {Array.from({ length: 30 }).map((_, idx) => (
                    <div
                      key={idx}
                      className="border-r border-b border-white/[0.03]"
                    />
                  ))}
                </div>

                {/* Left Vertical Sentiment Bar */}
                <div className="absolute left-2 sm:left-3 top-12 sm:top-14 bottom-12 sm:bottom-14 w-1.5 flex flex-col items-center justify-between z-10">
                  <span className="text-[8px] sm:text-[9px] font-mono text-[#0faf59] font-bold mb-1">
                    {sentimentUp}%
                  </span>
                  <div className="w-1.5 flex-1 bg-[#ff4b55] rounded-full overflow-hidden flex flex-col">
                    <div
                      style={{ height: `${sentimentUp}%` }}
                      className="w-full bg-[#0faf59] transition-all duration-500"
                    />
                  </div>
                  <span className="text-[8px] sm:text-[9px] font-mono text-[#ff4b55] font-bold mt-1">
                    {100 - sentimentUp}%
                  </span>
                </div>

                {/* Top Left Pair Info Overlay */}
                <div className="relative z-10 pl-5 sm:pl-6 flex items-center justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-1.5 sm:gap-2 text-[9px] sm:text-[10px] font-mono text-slate-400">
                      <span>14:33:45 UTC</span>
                      <span className="text-[#0faf59] font-bold">
                        • LIVE STREAM
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        setActivePairIdx((prev) => (prev + 1) % pairs.length)
                      }
                      className="mt-1 px-2 sm:px-2.5 py-0.5 sm:py-1 rounded bg-[#232a3d]/90 border border-white/10 text-[9px] sm:text-[10px] font-bold text-[#3898ff] inline-flex items-center gap-1.5"
                    >
                      <span>ⓘ PAIR INFORMATION</span>
                    </button>
                  </div>

                  {/* Mobile Play/Pause Button */}
                  <button
                    type="button"
                    onClick={() => setIsPlayingVideo((p) => !p)}
                    className="sm:hidden px-2 py-1 rounded bg-[#121622]/90 border border-white/10 text-[9px] font-mono text-slate-200 inline-flex items-center gap-1 mr-10"
                  >
                    {isPlayingVideo ? (
                      <>
                        <Pause className="w-2.5 h-2.5 text-[#0faf59]" />
                        <span>Pause</span>
                      </>
                    ) : (
                      <>
                        <Play className="w-2.5 h-2.5 text-[#0faf59]" />
                        <span>Play</span>
                      </>
                    )}
                  </button>

                  {/* Beginning / End of Trade Vertical Marker Labels */}
                  <div className="hidden md:flex items-center gap-12 pr-20 text-[10px] font-mono text-slate-400">
                    <div className="flex items-center gap-1.5">
                      <span>Beginning of trade</span>
                    </div>
                    <div className="flex items-center gap-1.5 text-white">
                      <span>End of trade</span>
                      <span className="px-1.5 py-0.5 rounded bg-[#2563eb] text-[9px] font-bold tabular-nums">
                        00:{countdown.toString().padStart(2, '0')}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Animated SVG Candlestick Chart */}
                <div className="relative flex-1 min-h-[165px] sm:min-h-[300px] my-3 sm:my-4 ml-5 sm:ml-6 mr-12 sm:mr-14">
                  {/* Vertical Dashed Trade Window Lines */}
                  <div className="absolute top-0 bottom-0 left-[58%] border-l border-dashed border-slate-500/50 pointer-events-none" />
                  <div className="absolute top-0 bottom-0 left-[78%] border-l border-dashed border-slate-400/60 pointer-events-none" />

                  {/* Active Trade Callout Tag on Chart */}
                  <div
                    style={{
                      top: `${priceToY(candles[candles.length - 1]?.open ?? 43.995)}%`,
                    }}
                    className="absolute left-[58%] sm:left-[62%] -translate-y-1/2 z-20 flex items-center gap-1 px-1.5 sm:px-2 py-0.5 rounded bg-[#0faf59] text-white text-[9px] sm:text-[10px] font-mono font-bold shadow-lg transition-all duration-500"
                  >
                    <span>{investment} $</span>
                    {activeDirection === 'UP' ? (
                      <ArrowUp className="w-2.5 h-2.5 sm:w-3 sm:h-3" />
                    ) : (
                      <ArrowDown className="w-2.5 h-2.5 sm:w-3 sm:h-3" />
                    )}
                  </div>

                  {/* Current Live Price Horizontal Line & Right Price Pill */}
                  <div
                    style={{ top: `${priceToY(currentPrice)}%` }}
                    className="absolute inset-x-0 border-t border-[#3898ff] z-10 transition-all duration-500"
                  >
                    <span className="absolute -right-12 sm:-right-14 -top-2.5 px-1 sm:px-1.5 py-0.5 rounded bg-[#3898ff] text-[9px] sm:text-[10px] font-mono font-bold text-white tabular-nums shadow">
                      {currentPrice.toFixed(4)}
                    </span>
                  </div>

                  {/* Candlesticks */}
                  <div className="absolute inset-0 flex items-stretch justify-between px-1 sm:px-2">
                    {candles.map((c, idx) => {
                      const isBull = c.close >= c.open;
                      const highY = priceToY(c.high);
                      const lowY = priceToY(c.low);
                      const bodyTop = priceToY(Math.max(c.open, c.close));
                      const bodyBottom = priceToY(Math.min(c.open, c.close));
                      const bodyHeight = Math.max(3, bodyBottom - bodyTop);
                      const isLast = idx === candles.length - 1;

                      return (
                        <div
                          key={c.id}
                          className="relative flex-1 flex justify-center"
                        >
                          {/* Wick */}
                          <div
                            style={{
                              top: `${highY}%`,
                              height: `${Math.max(4, lowY - highY)}%`,
                            }}
                            className={`w-[1.5px] absolute transition-all duration-500 ${
                              isBull ? 'bg-[#0faf59]' : 'bg-[#ff4b55]'
                            }`}
                          />
                          {/* Candle Body */}
                          <div
                            style={{
                              top: `${bodyTop}%`,
                              height: `${bodyHeight}%`,
                            }}
                            className={`w-2 sm:w-3.5 rounded-[1px] absolute transition-all duration-500 ${
                              isBull
                                ? 'bg-[#0faf59] shadow-[0_0_8px_rgba(15,175,89,0.35)]'
                                : 'bg-[#ff4b55] shadow-[0_0_8px_rgba(255,75,85,0.35)]'
                            } ${isLast ? 'ring-1 ring-white/40' : ''}`}
                          />
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Right Y-Axis Price Scale */}
                <div className="absolute right-1.5 sm:right-2 top-8 bottom-8 flex flex-col justify-between text-[8px] sm:text-[9px] font-mono text-slate-500 tabular-nums pointer-events-none">
                  <span>44.0030</span>
                  <span>44.0010</span>
                  <span>43.9990</span>
                  <span>43.9970</span>
                  <span>43.9950</span>
                  <span>43.9930</span>
                  <span>43.9910</span>
                </div>

                {/* Bottom Chart Controls & Timestamps */}
                <div className="relative z-10 pl-5 sm:pl-6 pr-10 sm:pr-12 flex items-center justify-between text-[9px] sm:text-[10px] font-mono text-slate-500">
                  <div className="flex items-center gap-1.5">
                    <span className="w-6 h-6 rounded bg-[#232a3d] text-slate-300 flex items-center justify-center font-sans text-xs font-bold">
                      1m
                    </span>
                    <span className="w-6 h-6 rounded bg-[#232a3d] text-slate-300 flex items-center justify-center">
                      <BarChart2 className="w-3.5 h-3.5" />
                    </span>
                  </div>

                  <div className="flex items-center gap-3 sm:gap-6 tabular-nums">
                    <span>14:12</span>
                    <span className="hidden xs:inline">14:20</span>
                    <span>14:28</span>
                    <span>14:36</span>
                  </div>

                  <div className="flex items-center gap-1">
                    <span className="w-6 h-6 rounded bg-[#232a3d] text-slate-400 flex items-center justify-center">
                      <Plus className="w-3 h-3" />
                    </span>
                    <span className="w-6 h-6 rounded bg-[#232a3d] text-slate-400 flex items-center justify-center">
                      <Minus className="w-3 h-3" />
                    </span>
                  </div>
                </div>
              </div>

              {/* Right Execution & Trades Panel */}
              <div className="col-span-12 sm:col-span-4 lg:col-span-3 bg-[#1c2130] border-t sm:border-t-0 sm:border-l border-[#283044] p-3 sm:p-3.5 flex flex-col justify-between">
                <div className="space-y-2.5 sm:space-y-3">
                  {/* Selected Pair Header + Pending Trade */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs">
                        {pairs[activePairIdx].flag1}
                        {pairs[activePairIdx].flag2}
                      </span>
                      <span className="text-xs font-bold text-white">
                        {pairs[activePairIdx].symbol}
                      </span>
                      <span className="text-[11px] font-mono text-[#f59e0b] font-bold sm:text-slate-400">
                        {pairs[activePairIdx].payout}
                      </span>
                    </div>
                    <div className="flex sm:hidden items-center gap-1.5 text-[10px] font-bold text-[#3898ff]">
                      <span>PENDING</span>
                      <div className="w-6 h-3.5 rounded-full bg-[#2a334b] p-0.5 flex items-center">
                        <div className="w-2.5 h-2.5 rounded-full bg-slate-400" />
                      </div>
                    </div>
                  </div>

                  {/* Desktop Pending Trade Row */}
                  <div className="hidden sm:flex items-center justify-between text-[10px] font-bold text-[#3898ff]">
                    <span>🕒 PENDING TRADE</span>
                    <div className="w-7 h-3.5 rounded-full bg-[#2a334b] p-0.5 flex items-center">
                      <div className="w-2.5 h-2.5 rounded-full bg-slate-400" />
                    </div>
                  </div>

                  {/* Time & Investment Grid (Side-by-side on mobile, stacked on desktop) */}
                  <div className="grid grid-cols-2 sm:grid-cols-1 gap-2 sm:gap-3">
                    {/* Time Box */}
                    <div className="rounded-lg bg-[#151926] border border-[#2a3248] p-2">
                      <div className="text-[10px] text-slate-400 mb-1">Time</div>
                      <div className="flex items-center justify-between">
                        <span className="w-5 h-5 rounded bg-[#232a3d] text-slate-300 flex items-center justify-center text-xs">
                          -
                        </span>
                        <span className="text-xs font-mono font-bold text-white tabular-nums">
                          00:00:{countdown.toString().padStart(2, '0')}
                        </span>
                        <span className="w-5 h-5 rounded bg-[#232a3d] text-slate-300 flex items-center justify-center text-xs">
                          +
                        </span>
                      </div>
                      <div className="text-center text-[8px] font-mono uppercase text-[#3898ff] mt-1">
                        SWITCH TIME
                      </div>
                    </div>

                    {/* Investment Box */}
                    <div className="rounded-lg bg-[#151926] border border-[#2a3248] p-2">
                      <div className="text-[10px] text-slate-400 mb-1">
                        Investment
                      </div>
                      <div className="flex items-center justify-between">
                        <button
                          type="button"
                          onClick={() =>
                            setInvestment((v) => Math.max(5, v - 5))
                          }
                          className="w-5 h-5 rounded bg-[#232a3d] hover:bg-[#2e3750] text-slate-300 flex items-center justify-center text-xs"
                        >
                          -
                        </button>
                        <span className="text-xs font-mono font-bold text-white tabular-nums">
                          {investment} $
                        </span>
                        <button
                          type="button"
                          onClick={() => setInvestment((v) => v + 5)}
                          className="w-5 h-5 rounded bg-[#232a3d] hover:bg-[#2e3750] text-slate-300 flex items-center justify-center text-xs"
                        >
                          +
                        </button>
                      </div>
                      <div className="text-center text-[8px] font-mono uppercase text-[#3898ff] mt-1">
                        SWITCH
                      </div>
                    </div>
                  </div>

                  {/* Payout Display on Mobile (Above Buttons) */}
                  <div className="sm:hidden flex items-center justify-between text-[11px] text-slate-300 font-mono tabular-nums px-0.5">
                    <span>Your payout:</span>
                    <span className="font-bold text-white">
                      {payoutAmount} $
                    </span>
                  </div>

                  {/* Up / Down Buttons (Side-by-side on mobile, stacked with Payout on desktop) */}
                  <div className="grid grid-cols-2 sm:grid-cols-1 gap-2 sm:gap-2.5">
                    <button
                      type="button"
                      onClick={() => {
                        setActiveDirection('UP');
                        setLiveBalance((b) => Number((b + 13.95).toFixed(2)));
                        setRecentWinFlash(true);
                        setTimeout(() => setRecentWinFlash(false), 900);
                      }}
                      className="w-full h-11 rounded-lg bg-[#0faf59] hover:bg-[#0d9c4f] px-3.5 flex items-center justify-between text-white font-bold text-sm shadow-lg shadow-[#0faf59]/20 transition-transform active:scale-[0.99]"
                    >
                      <span>Up</span>
                      <span className="w-6 h-6 rounded-full bg-white/20 flex items-center justify-center">
                        <ArrowUp className="w-3.5 h-3.5" />
                      </span>
                    </button>

                    {/* Desktop Payout Display */}
                    <div className="hidden sm:block text-center text-[11px] text-slate-300 font-mono tabular-nums">
                      Your payout:{' '}
                      <span className="font-bold text-white">
                        {payoutAmount} $
                      </span>
                    </div>

                    <button
                      type="button"
                      onClick={() => {
                        setActiveDirection('DOWN');
                        setLiveBalance((b) => Number((b + 13.95).toFixed(2)));
                        setRecentWinFlash(true);
                        setTimeout(() => setRecentWinFlash(false), 900);
                      }}
                      className="w-full h-11 rounded-lg bg-[#ff5252] hover:bg-[#e04343] px-3.5 flex items-center justify-between text-white font-bold text-sm shadow-lg shadow-[#ff5252]/20 transition-transform active:scale-[0.99]"
                    >
                      <span>Down</span>
                      <span className="w-6 h-6 rounded-full bg-white/20 flex items-center justify-center">
                        <ArrowDown className="w-3.5 h-3.5" />
                      </span>
                    </button>
                  </div>
                </div>

                {/* Recent Trades History Box */}
                <div className="mt-3 sm:mt-4 pt-2.5 sm:pt-3 border-t border-[#283044] space-y-2">
                  <div className="flex items-center justify-between text-[10px] font-bold text-slate-300">
                    <span>Trades 0</span>
                    <span className="text-slate-500">🕒 3</span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-1 gap-1.5 text-[10px] font-mono tabular-nums">
                    {[
                      {
                        pair: 'USD/EGP (OTC)',
                        time: '00:00:05',
                        inv: '15 $',
                        profit: '+28.95 $',
                      },
                      {
                        pair: 'AUD/CHF',
                        time: '00:00:43',
                        inv: '15 $',
                        profit: '+27.90 $',
                      },
                      {
                        pair: 'AUD/CHF',
                        time: '00:00:51',
                        inv: '10 $',
                        profit: '+18.60 $',
                      },
                    ].map((tr, i) => (
                      <div
                        key={i}
                        className="rounded bg-[#151926] px-2.5 py-1.5 flex items-center justify-between"
                      >
                        <div>
                          <div className="text-white font-sans font-semibold text-[10px]">
                            {tr.pair}
                          </div>
                          <div className="text-[9px] text-[#0faf59]">
                            ▲ {tr.inv}
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-[9px] text-slate-400">
                            {tr.time}
                          </div>
                          <div className="text-[#0faf59] font-bold">
                            {tr.profit}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* =================================================================== */}
      {/* FEATURES OF THE PLATFORM                                            */}
      {/* =================================================================== */}
      <section id="features" className="py-12 sm:py-20 max-w-[1140px] mx-auto px-3.5 sm:px-6">
        <div className="text-center max-w-xl mx-auto mb-9 sm:mb-14">
          <h2 className="text-2xl sm:text-4xl font-extrabold text-white tracking-tight">
            Features of the platform
          </h2>
          <p className="mt-2.5 sm:mt-3 text-xs sm:text-sm text-slate-400">
            We regularly improve our platform to make your trading comfortable
            and safe.
          </p>
        </div>

        {/* 6 Feature Cards Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
          {/* Card 1 */}
          <div className="rounded-2xl bg-[#161c2a] border border-white/[0.05] p-5 sm:p-7 flex flex-col justify-between hover:border-white/15 transition-colors">
            <div>
              <div className="w-11 h-11 rounded-xl bg-[#7c4dff]/20 border border-[#7c4dff]/40 flex items-center justify-center text-[#9d7aff] mb-4 sm:mb-6">
                <Monitor className="w-5 h-5" />
              </div>
              <h3 className="text-base font-extrabold text-white mb-2">
                User-friendly interface
              </h3>
              <p className="text-xs text-slate-400 leading-relaxed">
                You have access to all the trading instruments you need, and
                their speed is impressive.
              </p>
            </div>
            <Link
              href="/register"
              className="mt-5 sm:mt-7 inline-flex items-center gap-1.5 text-xs font-bold text-[#3898ff] hover:text-[#60aeff] transition-colors w-fit"
            >
              <span>Sign up</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>

          {/* Card 2 */}
          <div className="rounded-2xl bg-[#161c2a] border border-white/[0.05] p-5 sm:p-7 flex flex-col justify-between hover:border-white/15 transition-colors">
            <div>
              <div className="w-11 h-11 rounded-xl bg-[#ff5252]/20 border border-[#ff5252]/40 flex items-center justify-center text-[#ff6b6b] mb-4 sm:mb-6">
                <Radio className="w-5 h-5" />
              </div>
              <h3 className="text-base font-extrabold text-white mb-2">
                Integrated signals
              </h3>
              <p className="text-xs text-slate-400 leading-relaxed">
                Signals with 87% accuracy rate will help you to build a
                profitable strategy.
              </p>
            </div>
            <Link
              href="/dashboard"
              className="mt-5 sm:mt-7 inline-flex items-center gap-1.5 text-xs font-bold text-[#3898ff] hover:text-[#60aeff] transition-colors w-fit"
            >
              <span>Try it</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>

          {/* Card 3 */}
          <div className="rounded-2xl bg-[#161c2a] border border-white/[0.05] p-5 sm:p-7 flex flex-col justify-between hover:border-white/15 transition-colors">
            <div>
              <div className="w-11 h-11 rounded-xl bg-[#2563eb]/20 border border-[#2563eb]/40 flex items-center justify-center text-[#3898ff] mb-4 sm:mb-6">
                <Compass className="w-5 h-5" />
              </div>
              <h3 className="text-base font-extrabold text-white mb-2">
                Trading indicators
              </h3>
              <p className="text-xs text-slate-400 leading-relaxed">
                We have collected the most useful trading indicators for you.
                Test them on a demo account to see which ones best suit your
                trading style.
              </p>
            </div>
            <Link
              href="/dashboard"
              className="mt-5 sm:mt-7 inline-flex items-center gap-1.5 text-xs font-bold text-[#3898ff] hover:text-[#60aeff] transition-colors w-fit"
            >
              <span>Explore</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>

          {/* Card 4 */}
          <div className="rounded-2xl bg-[#161c2a] border border-white/[0.05] p-5 sm:p-7 flex flex-col justify-between hover:border-white/15 transition-colors">
            <div>
              <div className="w-11 h-11 rounded-xl bg-[#f59e0b]/20 border border-[#f59e0b]/40 flex items-center justify-center text-[#fbbf24] mb-4 sm:mb-6">
                <Headphones className="w-5 h-5" />
              </div>
              <h3 className="text-base font-extrabold text-white mb-2">
                Support 24/7
              </h3>
              <p className="text-xs text-slate-400 leading-relaxed">
                Our highly trained support staff is ready to assist you at any
                time.
              </p>
            </div>
            <Link
              href="/login"
              className="mt-5 sm:mt-7 inline-flex items-center gap-1.5 text-xs font-bold text-[#3898ff] hover:text-[#60aeff] transition-colors w-fit"
            >
              <span>Submit a request</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>

          {/* Card 5 */}
          <div className="rounded-2xl bg-[#161c2a] border border-white/[0.05] p-5 sm:p-7 flex flex-col justify-between hover:border-white/15 transition-colors">
            <div>
              <div className="w-11 h-11 rounded-xl bg-[#0faf59]/20 border border-[#0faf59]/40 flex items-center justify-center text-[#22c55e] mb-4 sm:mb-6">
                <Gift className="w-5 h-5" />
              </div>
              <h3 className="text-base font-extrabold text-white mb-2">
                Bonus programs
              </h3>
              <p className="text-xs text-slate-400 leading-relaxed">
                Participate in tournaments and giveaways for traders to get
                bonuses.
              </p>
            </div>
            <Link
              href="/register"
              className="mt-5 sm:mt-7 inline-flex items-center gap-1.5 text-xs font-bold text-[#3898ff] hover:text-[#60aeff] transition-colors w-fit"
            >
              <span>Get a bonus</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>

          {/* Card 6 */}
          <div className="rounded-2xl bg-[#161c2a] border border-white/[0.05] p-5 sm:p-7 flex flex-col justify-between hover:border-white/15 transition-colors">
            <div>
              <div className="w-11 h-11 rounded-xl bg-[#06b6d4]/20 border border-[#06b6d4]/40 flex items-center justify-center text-[#22d3ee] mb-4 sm:mb-6">
                <RefreshCw className="w-5 h-5" />
              </div>
              <h3 className="text-base font-extrabold text-white mb-2">
                Deposits and withdrawals
              </h3>
              <p className="text-xs text-slate-400 leading-relaxed">
                Various deposit options and fast withdrawal of funds. The
                minimum deposit is only 10 USD.
              </p>
            </div>
            <Link
              href="/wallet"
              className="mt-5 sm:mt-7 inline-flex items-center gap-1.5 text-xs font-bold text-[#3898ff] hover:text-[#60aeff] transition-colors w-fit"
            >
              <span>Start trading</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>
        </div>

        {/* Horizontal Demo / Register Banner Bar */}
        <div className="mt-5 sm:mt-6 rounded-2xl bg-[#161c2a] border border-white/[0.05] p-4 sm:px-6 sm:py-5 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div className="flex items-start sm:items-center gap-3.5 sm:gap-4">
            <div className="w-11 h-11 sm:w-12 sm:h-12 rounded-xl bg-[#2563eb]/20 border border-[#3898ff]/30 flex items-center justify-center text-[#3898ff] shrink-0">
              <Award className="w-5 h-5 sm:w-6 sm:h-6" />
            </div>
            <div className="text-xs sm:text-sm font-bold text-white leading-snug">
              Trade on demo – no registration is required!
              <span className="block text-slate-300 font-semibold mt-0.5">
                Or register a personal account to access additional features.
              </span>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:flex items-center gap-2.5 sm:gap-3 w-full md:w-auto justify-end">
            <Link
              href="/dashboard"
              className="h-10 px-4 sm:px-5 rounded-lg bg-[#232b3e] hover:bg-[#2d374f] text-xs font-bold text-white inline-flex items-center justify-center transition-colors"
            >
              Try demo
            </Link>
            <Link
              href="/register"
              className="h-10 px-4 sm:px-5 rounded-lg bg-[#0faf59] hover:bg-[#0d9c4f] text-xs font-bold text-white inline-flex items-center justify-center shadow-lg shadow-[#0faf59]/20 transition-colors"
            >
              Register an account
            </Link>
          </div>
        </div>
      </section>

      {/* =================================================================== */}
      {/* GROW YOUR CAPITAL BY MAKING THE RIGHT TRADING PREDICTIONS           */}
      {/* =================================================================== */}
      <section className="py-6 sm:py-10 max-w-[1140px] mx-auto px-3.5 sm:px-6">
        <div className="relative rounded-2xl sm:rounded-3xl bg-[#eaedf4] text-[#101420] p-5 sm:p-12 lg:p-14 overflow-hidden">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 sm:gap-10 items-center relative z-10">
            {/* Left Copy & CTA */}
            <div className="lg:col-span-6 space-y-4 sm:space-y-5">
              <h2 className="text-xl sm:text-4xl font-extrabold tracking-tight text-[#101420] leading-tight">
                Grow your capital by making the right trading predictions
              </h2>
              <p className="text-xs sm:text-sm text-slate-600 max-w-md leading-relaxed">
                Will the price go up or down? Predict the price movement of a
                trading asset and place a trade.
              </p>

              <div className="pt-1 sm:pt-2 flex flex-col sm:flex-row sm:flex-wrap items-stretch sm:items-center gap-3 sm:gap-4">
                <Link
                  href="/dashboard"
                  className="h-11 px-6 rounded-lg bg-[#0faf59] hover:bg-[#0d9c4f] text-xs sm:text-sm font-bold text-white inline-flex items-center justify-center shadow-md transition-colors"
                >
                  Try it for free
                </Link>
                <span className="text-xs text-slate-500 text-center sm:text-left">
                  Practice on a demo account without registration.
                </span>
              </div>

              {/* Decorative Line Chart Graphic */}
              <div className="pt-3 sm:pt-6">
                <svg
                  viewBox="0 0 420 90"
                  className="w-full max-w-[380px] h-16 sm:h-20 overflow-visible"
                >
                  <path
                    d="M 0 80 L 35 58 L 55 68 L 90 38 L 115 50 L 145 20 L 175 45 L 210 55"
                    fill="none"
                    stroke="#2563eb"
                    strokeWidth="2.5"
                  />
                  <path
                    d="M 210 55 L 265 28 L 320 12"
                    fill="none"
                    stroke="#0faf59"
                    strokeWidth="2.5"
                    strokeDasharray="4 4"
                  />
                  <path
                    d="M 210 55 L 270 72 L 320 82"
                    fill="none"
                    stroke="#ff4b55"
                    strokeWidth="2"
                    strokeDasharray="4 4"
                  />
                  <circle cx="210" cy="55" r="5" fill="#101420" />
                  <circle
                    cx="210"
                    cy="55"
                    r="11"
                    fill="none"
                    stroke="#2563eb"
                    strokeWidth="1.5"
                    opacity="0.4"
                  />
                </svg>
              </div>
            </div>

            {/* Right 2x2 Step Cards */}
            <div className="lg:col-span-6 grid grid-cols-2 gap-3 sm:gap-4">
              {[
                {
                  step: '1. Select an asset',
                  icon: <Flame className="w-5 h-5 text-white" />,
                },
                {
                  step: '2. Monitor the chart',
                  icon: <LineChart className="w-5 h-5 text-white" />,
                },
                {
                  step: '3. Place a trade',
                  icon: <TrendingUp className="w-5 h-5 text-white" />,
                },
                {
                  step: '4. Get the result',
                  icon: <DollarSign className="w-5 h-5 text-white" />,
                },
              ].map((item) => (
                <div
                  key={item.step}
                  className="rounded-xl sm:rounded-2xl bg-white p-4 sm:p-7 shadow-sm flex flex-col items-center justify-center text-center gap-2.5 sm:gap-3.5"
                >
                  <div className="w-10 h-10 sm:w-11 sm:h-11 rounded-xl bg-[#0faf59] flex items-center justify-center shadow-md shadow-[#0faf59]/25">
                    {item.icon}
                  </div>
                  <span className="text-xs sm:text-sm font-extrabold text-[#101420]">
                    {item.step}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* =================================================================== */}
      {/* WHAT PEOPLE SAY ABOUT US (REVIEWS)                                  */}
      {/* =================================================================== */}
      <section id="reviews" className="py-12 sm:py-20 max-w-[1140px] mx-auto px-3.5 sm:px-6">
        <div className="text-center max-w-xl mx-auto mb-9 sm:mb-14">
          <h2 className="text-2xl sm:text-4xl font-extrabold text-white tracking-tight">
            What people say about us
          </h2>
          <p className="mt-2.5 sm:mt-3 text-xs sm:text-sm text-slate-400">
            We asked our customers to rate Quotex on a five-point scale.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
          {REVIEWS.map((rev, idx) => {
            const isExpanded = !!expandedReviews[idx];
            return (
              <div
                key={rev.name}
                className="rounded-2xl bg-[#161c2a] border border-white/[0.05] p-5 sm:p-7 flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-start justify-between">
                    <div>
                      <h3 className="text-sm font-extrabold text-white">
                        {rev.name}
                      </h3>
                      <p className="text-[11px] font-mono text-slate-500 mt-0.5 tabular-nums">
                        {rev.date}
                      </p>
                      <p className="text-[11px] text-slate-400 mt-0.5 tabular-nums">
                        Earned:{' '}
                        <span className="text-white font-bold">
                          {rev.earned}
                        </span>
                      </p>
                    </div>
                  </div>

                  {/* 5 Green Stars */}
                  <div className="flex items-center gap-1 my-3.5 sm:my-4">
                    {Array.from({ length: 5 }).map((_, sIdx) => (
                      <Star
                        key={sIdx}
                        className="w-3.5 h-3.5 text-[#0faf59] fill-[#0faf59]"
                      />
                    ))}
                  </div>

                  <p className="text-xs text-slate-300 leading-relaxed">
                    {isExpanded ? rev.fullText : rev.shortText}
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() =>
                    setExpandedReviews((prev) => ({
                      ...prev,
                      [idx]: !prev[idx],
                    }))
                  }
                  className="mt-4 sm:mt-5 inline-flex items-center gap-1.5 text-xs font-bold text-[#3898ff] hover:text-[#60aeff] transition-colors w-fit"
                >
                  <span>{isExpanded ? 'Show Less' : 'Read More'}</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>
            );
          })}
        </div>

        <div className="mt-8 sm:mt-10 text-center">
          <Link
            href="/register"
            className="w-full sm:w-auto justify-center h-11 px-6 rounded-lg bg-[#0faf59] hover:bg-[#0d9c4f] text-xs font-bold text-white inline-flex items-center gap-2 shadow-lg shadow-[#0faf59]/20 transition-colors"
          >
            <span>View all reviews</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>
      </section>

      {/* =================================================================== */}
      {/* MOBILE APP IS ALWAYS AT YOUR FINGERTIPS                             */}
      {/* =================================================================== */}
      <section className="py-12 sm:py-16 max-w-[1140px] mx-auto px-3.5 sm:px-6 border-b border-white/[0.06]">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 sm:gap-10 items-center">
          {/* Left Phone Mockup + Rating Badge */}
          <div className="lg:col-span-6 relative flex justify-center pt-4 sm:pt-0">
            {/* Blue Floating App Rating Badge */}
            <div className="absolute left-2 sm:left-12 -top-2 sm:-top-4 z-20 rounded-xl bg-[#1d7dfa] text-white px-3.5 py-2.5 sm:px-4 sm:py-3 shadow-xl text-center">
              <div className="text-[8px] sm:text-[9px] font-bold uppercase tracking-wider opacity-90">
                APP RATING
              </div>
              <div className="text-xl sm:text-2xl font-extrabold leading-tight tabular-nums">
                4,8
              </div>
              <div className="flex items-center justify-center gap-0.5 mt-0.5 sm:mt-1 text-[#fbbf24] text-[10px]">
                <span>★</span>
                <span>★</span>
                <span>★</span>
                <span>★</span>
                <span>★</span>
              </div>
            </div>

            {/* Angled Phone Preview Card */}
            <div className="w-full max-w-[280px] sm:max-w-[320px] h-64 sm:h-72 rounded-t-3xl bg-gradient-to-b from-[#232b3e] to-[#151a28] border-t-4 border-x-4 border-[#343f59] p-4 shadow-2xl overflow-hidden flex flex-col justify-between">
              <div className="flex items-center justify-between text-[10px] text-slate-300">
                <span className="font-mono font-bold">6:47</span>
                <span className="px-2 py-0.5 rounded bg-[#0faf59]/20 text-[#0faf59] font-mono font-bold">
                  LIVE $10,950.00
                </span>
              </div>

              <div className="my-auto space-y-2">
                <div className="text-xs font-bold text-white">
                  EUR/CAD (OTC) • 92%
                </div>
                <div className="h-24 sm:h-28 rounded-xl bg-[#101420] border border-white/10 p-3 flex items-end justify-between gap-1.5">
                  {[40, 65, 50, 80, 60, 90, 75, 95, 70, 88].map((h, i) => (
                    <div
                      key={i}
                      style={{ height: `${h}%` }}
                      className={`flex-1 rounded-xs ${
                        i % 3 === 0 ? 'bg-[#ff4b55]' : 'bg-[#0faf59]'
                      }`}
                    />
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="h-8 rounded bg-[#0faf59] text-white text-[10px] font-bold flex items-center justify-center">
                  UP ▲
                </div>
                <div className="h-8 rounded bg-[#ff4b55] text-white text-[10px] font-bold flex items-center justify-center">
                  DOWN ▼
                </div>
              </div>
            </div>
          </div>

          {/* Right Copy & Download Buttons */}
          <div className="lg:col-span-6 space-y-4 sm:space-y-5 text-center lg:text-left">
            <h2 className="text-2xl sm:text-4xl font-extrabold text-white tracking-tight leading-tight">
              Mobile app is always at{' '}
              <span className="sm:block">your fingertips</span>
            </h2>
            <p className="text-xs sm:text-sm text-slate-400 max-w-md mx-auto lg:mx-0 leading-relaxed">
              Download our user-friendly trading app to your mobile device and
              start trading.
            </p>

            <div className="pt-2 grid grid-cols-2 sm:flex sm:flex-wrap items-center justify-center lg:justify-start gap-2.5 sm:gap-3.5">
              <Link
                href="/dashboard"
                className="h-12 px-4 sm:px-5 rounded-xl bg-[#0b0e17] hover:bg-[#161c2c] border border-white/15 inline-flex items-center justify-center sm:justify-start gap-2.5 sm:gap-3 transition-colors"
              >
                <Play className="w-5 h-5 text-[#0faf59] fill-[#0faf59] shrink-0" />
                <div className="text-left leading-tight">
                  <span className="text-[9px] uppercase text-slate-400 block">
                    GET IT ON
                  </span>
                  <span className="text-xs font-bold text-white">
                    Google Play
                  </span>
                </div>
              </Link>

              <Link
                href="/dashboard"
                className="h-12 px-4 sm:px-5 rounded-xl bg-[#0b0e17] hover:bg-[#161c2c] border border-white/15 inline-flex items-center justify-center sm:justify-start gap-2.5 sm:gap-3 transition-colors"
              >
                <Smartphone className="w-5 h-5 text-white shrink-0" />
                <div className="text-left leading-tight">
                  <span className="text-[9px] uppercase text-slate-400 block">
                    Progressive
                  </span>
                  <span className="text-xs font-bold text-white">Web App</span>
                </div>
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* =================================================================== */}
      {/* FREQUENTLY ASKED QUESTIONS                                          */}
      {/* =================================================================== */}
      <section id="faq" className="py-12 sm:py-20 max-w-[920px] mx-auto px-3.5 sm:px-6">
        <div className="text-center max-w-xl mx-auto mb-8 sm:mb-12">
          <h2 className="text-2xl sm:text-4xl font-extrabold text-white tracking-tight">
            Frequently asked questions
          </h2>
          <p className="mt-2.5 sm:mt-3 text-xs sm:text-sm text-slate-400">
            See the most common questions of new traders answered here.
          </p>
        </div>

        <div className="space-y-2.5 sm:space-y-3">
          {FAQS.map((item, idx) => {
            const isOpen = openFaqIdx === idx;
            return (
              <div
                key={item.q}
                className="rounded-xl bg-[#161c2a] border border-white/[0.05] overflow-hidden"
              >
                <button
                  type="button"
                  onClick={() => setOpenFaqIdx(isOpen ? null : idx)}
                  className="w-full px-4 sm:px-6 py-3.5 sm:py-4 text-left flex items-center justify-between gap-3 sm:gap-4 hover:bg-white/[0.02] transition-colors"
                >
                  <span className="text-xs sm:text-sm font-bold text-white">
                    {item.q}
                  </span>
                  <span className="text-[#3898ff] shrink-0">
                    {isOpen ? (
                      <Minus className="w-4 h-4" />
                    ) : (
                      <Plus className="w-4 h-4" />
                    )}
                  </span>
                </button>
                {isOpen && (
                  <div className="px-4 sm:px-6 pb-4 sm:pb-5 text-xs text-slate-300 leading-relaxed border-t border-white/[0.04] pt-3">
                    {item.a}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Bottom Question Callout Box */}
        <div className="mt-8 sm:mt-10 flex justify-center sm:justify-end">
          <div className="w-full sm:w-auto rounded-2xl bg-[#161c2a] border border-white/[0.05] px-4 sm:px-6 py-4 flex items-center justify-between sm:justify-start gap-4 max-w-md">
            <div className="text-xs text-slate-300 leading-relaxed">
              Do you have other questions?
              <span className="block">
                Go to all questions in the{' '}
                <a href="#faq" className="text-[#3898ff] hover:underline">
                  FAQ section
                </a>{' '}
                or{' '}
                <Link href="/login" className="text-[#3898ff] hover:underline">
                  contact us
                </Link>
                .
              </span>
            </div>
            <div className="w-11 h-11 rounded-xl bg-[#0faf59]/20 border border-[#0faf59]/40 flex items-center justify-center text-[#0faf59] font-extrabold text-xl shrink-0">
              ?
            </div>
          </div>
        </div>
      </section>

      {/* =================================================================== */}
      {/* FOOTER                                                              */}
      {/* =================================================================== */}
      <footer className="bg-[#0c101a] border-t border-white/[0.05] py-12 sm:py-16 text-xs text-slate-400">
        <div className="max-w-[1140px] mx-auto px-3.5 sm:px-6">
          <div className="grid grid-cols-2 md:grid-cols-12 gap-6 sm:gap-8 pb-10 sm:pb-12 border-b border-white/[0.06]">
            {/* Col 1: Logo */}
            <div className="col-span-2 md:col-span-3">
              <Link href="/" className="flex items-center gap-2">
                <Zap className="w-5 h-5 text-[#0faf59] fill-[#0faf59]" />
                <span className="text-base font-extrabold tracking-wider text-white">
                  QUOTEX
                </span>
              </Link>
            </div>

            {/* Col 2: FAQ */}
            <div className="col-span-1 md:col-span-2 space-y-2.5">
              <div className="font-bold text-white">FAQ ›</div>
              <ul className="space-y-2 text-slate-400">
                <li>
                  <a href="#faq" className="hover:text-white transition-colors">
                    General questions
                  </a>
                </li>
                <li>
                  <Link
                    href="/wallet"
                    className="hover:text-white transition-colors"
                  >
                    Financial questions
                  </Link>
                </li>
                <li>
                  <Link
                    href="/login"
                    className="hover:text-white transition-colors"
                  >
                    Verification
                  </Link>
                </li>
              </ul>
            </div>

            {/* Col 3: About us */}
            <div className="col-span-1 md:col-span-2 space-y-2.5">
              <div className="font-bold text-white">About us ›</div>
              <ul className="space-y-2 text-slate-400">
                <li>
                  <a
                    href="#reviews"
                    className="hover:text-white transition-colors"
                  >
                    Reviews
                  </a>
                </li>
                <li>
                  <Link
                    href="/login"
                    className="hover:text-white transition-colors"
                  >
                    Contacts
                  </Link>
                </li>
              </ul>
            </div>

            {/* Col 4: More */}
            <div className="col-span-2 sm:col-span-1 md:col-span-2 space-y-2.5">
              <div className="font-bold text-white">More</div>
              <ul className="space-y-2 text-slate-400">
                <li>
                  <Link
                    href="/dashboard"
                    className="hover:text-white transition-colors"
                  >
                    Demo account
                  </Link>
                </li>
                <li>
                  <Link
                    href="/register"
                    className="hover:text-white transition-colors"
                  >
                    Affiliate program ↗
                  </Link>
                </li>
              </ul>
            </div>

            {/* Col 5: Download & Social */}
            <div className="col-span-2 md:col-span-3 space-y-3">
              <div className="text-[11px] text-slate-400">Download the app</div>
              <div className="grid grid-cols-1 sm:flex sm:flex-col gap-2 w-full sm:w-48">
                <Link
                  href="/dashboard"
                  className="h-9 sm:h-8 px-3 rounded bg-[#141926] border border-white/10 flex items-center justify-between text-[11px] font-bold text-white hover:border-white/25"
                >
                  <span>Google Play</span>
                  <Play className="w-3 h-3 text-[#0faf59]" />
                </Link>
                <Link
                  href="/dashboard"
                  className="h-9 sm:h-8 px-3 rounded bg-[#141926] border border-white/10 flex items-center justify-between text-[11px] font-bold text-white hover:border-white/25"
                >
                  <span>Web App (iOS / Desktop)</span>
                  <Monitor className="w-3 h-3 text-[#3898ff]" />
                </Link>
              </div>
            </div>
          </div>

          {/* Bottom Legal & Risk Disclosure */}
          <div className="pt-8 sm:pt-10 grid grid-cols-1 md:grid-cols-12 gap-6 sm:gap-8 text-[11px] text-slate-500 leading-relaxed">
            <div className="md:col-span-3 space-y-2">
              <div className="font-bold text-slate-300">Regulations</div>
              <ul className="grid grid-cols-2 sm:grid-cols-1 gap-1.5">
                <li>Privacy policy</li>
                <li>Service agreement</li>
                <li>Risk disclosure</li>
                <li>Rules of trading operations</li>
                <li>Non-trading operations regulations</li>
                <li>Payment policy</li>
              </ul>
            </div>

            <div className="md:col-span-9 space-y-3">
              <p>
                ON SPOT GROUP LLC. Address: Main Street, P.O. Box 625,
                Charlestown, St. Kitts and Nevis.
              </p>
              <p>
                Risk Warning: Trading Forex and Leveraged Financial Instruments
                involves significant risk and can result in the loss of your
                invested capital. You should not invest more than you can afford
                to lose and should ensure that you fully understand the risks
                involved. Trading leveraged products may not be suitable for all
                investors.
              </p>
              <p className="text-slate-400 pt-2">
                Copyright © 2026 Quotex. All rights reserved
              </p>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
