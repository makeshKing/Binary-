// app/layout.tsx
import type { Metadata } from 'next';
import './globals.css';
import { CurrencyProvider } from '@/components/CurrencyProvider';
import { AppBootGate } from '@/components/LoadingScreen';

export const dynamic = 'force-dynamic';

const plusJakarta = { variable: 'font-sans' };
const jetbrainsMono = { variable: 'font-mono' };

export const metadata: Metadata = {
  title: 'QUOTEX — Web Trading Platform',
  description:
    'Real-time binary-options trading platform powered by Supabase Auth, PostgreSQL RPCs, Row Level Security, and Realtime.',
  openGraph: {
    title: 'QUOTEX — Web Trading Platform',
    description:
      'Real-time binary-options trading platform powered by Supabase Auth, PostgreSQL RPCs, Row Level Security, and Realtime.',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'QUOTEX — Web Trading Platform',
    description:
      'Real-time binary-options trading platform powered by Supabase Auth, PostgreSQL RPCs, Row Level Security, and Realtime.',
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const runtimeSupabaseUrl = (
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.SUPABASE_URL ||
    ''
  ).trim();
  const runtimeSupabaseAnonKey = (
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    ''
  ).trim();

  const serializedConfig = JSON.stringify({
    url: runtimeSupabaseUrl,
    anonKey: runtimeSupabaseAnonKey,
  });

  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${plusJakarta.variable} ${jetbrainsMono.variable} dark`}
    >
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `window.__SUPABASE_CONFIG__ = ${serializedConfig};
window.addEventListener('error', function(e) {
  if (e && e.message && (e.message.indexOf('ChunkLoadError') !== -1 || e.message.indexOf('Loading chunk') !== -1)) {
    window.location.reload();
  }
});
window.addEventListener('unhandledrejection', function(e) {
  if (e && e.reason && e.reason.name === 'ChunkLoadError') {
    window.location.reload();
  }
});`,
          }}
        />
      </head>
      <body
        suppressHydrationWarning
        className="min-h-screen bg-[#0F172A] text-slate-100 font-sans antialiased selection:bg-blue-500/30 selection:text-blue-200 flex flex-col"
      >
        <CurrencyProvider>
          <AppBootGate>
            <div className="flex-1 flex flex-col">{children}</div>
          </AppBootGate>
        </CurrencyProvider>
      </body>
    </html>
  );
}
