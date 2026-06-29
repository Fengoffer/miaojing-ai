'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { Toaster } from '@/components/ui/sonner';
import { Navbar } from '@/components/navbar';
import { SiteConfigSync } from '@/components/site-config-sync';
import { VisitTracker } from '@/components/visit-tracker';
import { AccountThemeSync } from '@/components/account-theme-sync';

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const isConsole = pathname === '/console' || pathname.startsWith('/console/');
  const scrollbarTimerRef = useRef<number | null>(null);

  useEffect(() => {
    const root = document.documentElement;
    const showScrollbars = () => {
      root.classList.add('scrollbars-visible');
      if (scrollbarTimerRef.current !== null) {
        window.clearTimeout(scrollbarTimerRef.current);
      }
      scrollbarTimerRef.current = window.setTimeout(() => {
        root.classList.remove('scrollbars-visible');
        scrollbarTimerRef.current = null;
      }, 900);
    };

    window.addEventListener('wheel', showScrollbars, { passive: true, capture: true });
    window.addEventListener('touchmove', showScrollbars, { passive: true, capture: true });
    return () => {
      window.removeEventListener('wheel', showScrollbars, { capture: true });
      window.removeEventListener('touchmove', showScrollbars, { capture: true });
      if (scrollbarTimerRef.current !== null) {
        window.clearTimeout(scrollbarTimerRef.current);
      }
      root.classList.remove('scrollbars-visible');
    };
  }, []);

  return (
    <>
      <SiteConfigSync />
      <AccountThemeSync />
      {!isConsole && <VisitTracker />}
      {!isConsole && <Navbar />}
      <main className="min-w-0 w-full">{children}</main>
      <Toaster />
    </>
  );
}
