import type { Metadata, Viewport } from 'next';
import { Inspector } from 'react-dev-inspector';
import { ThemeProvider } from 'next-themes';
import { AppShell } from '@/modules/web';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: '妙境 - AI创作平台',
    template: '%s | 妙境',
  },
  description: '妙手丹青，境随心造 - 一站式AI多模态创作平台，提供文生图、图生图、文生视频、图生视频四大核心能力',
  icons: {
    icon: '/favicon.png',
    apple: '/apple-touch-icon.png',
  },
  keywords: [
    '妙境',
    'AI创作',
    '文生图',
    '图生图',
    '文生视频',
    '图生视频',
    'AI绘画',
    'AI视频',
  ],
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const isDev = process.env.COZE_PROJECT_ENV === 'DEV';

  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body className="antialiased">
        <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false} disableTransitionOnChange>
          {isDev && <Inspector />}
          <AppShell>{children}</AppShell>
        </ThemeProvider>
      </body>
    </html>
  );
}
