import type { Metadata, Viewport } from 'next';
import Script from 'next/script';
import { Chakra_Petch, JetBrains_Mono } from 'next/font/google';
import { Providers } from '@/lib/providers/providers';
import './globals.css';

/**
 * Self-host the Neon Terminal typefaces via next/font (build-time, served from
 * our own origin). A Google Fonts @import would be blocked by the Telegram Mini
 * App CSP (style-src/font-src don't allow fonts.googleapis/gstatic).
 */
const chakraPetch = Chakra_Petch({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-chakra',
  display: 'swap',
});
const jetBrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800'],
  variable: '--font-jbmono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'azimuth',
  description:
    'Trade tokenized stocks, RWAs and Hyperliquid perps from Telegram — funded straight from your TON wallet.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Do NOT disable user scaling — pinch-zoom is an accessibility requirement
  // for low-vision users. `viewportFit: cover` handles the notch instead.
  viewportFit: 'cover',
  themeColor: '#04060b',
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${chakraPetch.variable} ${jetBrainsMono.variable}`}>
      <body className="antialiased">
        {/*
         * Telegram WebApp runtime. Loaded synchronously so `window.Telegram.WebApp`
         * exists before client components hydrate. TON Connect uses it to detect
         * the Telegram Mini App environment (platform/version) and pick the NATIVE
         * in-Telegram wallet-open path (`web_app_open_tg_link`) instead of falling
         * back to `window.open(_blank)` — the latter breaks connecting to TMA
         * wallets like @wallet (the wallet connects but never returns into the app).
         */}
        <Script
          src="https://telegram.org/js/telegram-web-app.js"
          strategy="beforeInteractive"
        />
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
