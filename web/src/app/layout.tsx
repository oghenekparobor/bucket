import type { Metadata, Viewport } from 'next';
import { Archivo, JetBrains_Mono } from 'next/font/google';
import type { ReactNode } from 'react';
import { Providers } from '@/components/Providers';
import { AppShell } from '@/components/shell/AppShell';
import { config } from '@/lib/config';
import './globals.css';

const archivo = Archivo({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-archivo',
  display: 'swap',
});

const jetbrains = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-jetbrains',
  display: 'swap',
});

export const metadata: Metadata = {
  metadataBase: new URL(config.siteUrl),
  title: { default: 'Bucket', template: '%s · Bucket' },
  description:
    'Bundle tokenized stocks into a weighted bucket, share the link, and earn a commission when it makes new highs. Anyone can invest from $1.',
  applicationName: 'Bucket',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#EFEEEA',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${archivo.variable} ${jetbrains.variable}`}>
      {/* Browser extensions often add attributes to <body> before hydration. */}
      <body suppressHydrationWarning>
        <Providers>
          <AppShell>{children}</AppShell>
        </Providers>
      </body>
    </html>
  );
}
