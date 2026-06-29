'use client';

import React, { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useTheme } from 'next-themes';
import { cn } from '@/lib/utils';
import { useAuth } from '@/lib/auth-store';
import { useSiteConfig } from '@/lib/site-config';
import {
  Brush,
  LayoutGrid,
  User,
  Menu,
  X,
  LogIn,
  Sparkles,
  LogOut,
  Shield,
  Moon,
  Sun,
} from 'lucide-react';
import { Button } from '@/components/ui/button';

const navItems = [
  { href: '/', label: '首页', icon: Sparkles },
  { href: '/create', label: '创作', icon: Brush },
  { href: '/gallery', label: '画廊', icon: LayoutGrid },
  { href: '/profile', label: '我的', icon: User },
];

function UserAvatar({ avatarUrl, nickname, size = 'md' }: { avatarUrl?: string | null; nickname: string; size?: 'sm' | 'md' }) {
  const [imageFailed, setImageFailed] = useState(false);
  const initial = (nickname || '用').trim().charAt(0).toUpperCase();
  const sizeClass = size === 'sm' ? 'h-5 w-5 text-[10px]' : 'h-8 w-8 text-sm';

  useEffect(() => {
    setImageFailed(false);
  }, [avatarUrl]);

  return (
    <div className={cn('flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary/10 text-primary font-bold', sizeClass)}>
      {avatarUrl && !imageFailed ? (
        <img
          src={avatarUrl}
          alt={nickname || '用户头像'}
          className="h-full w-full object-cover"
          onError={() => setImageFailed(true)}
        />
      ) : (
        initial
      )}
    </div>
  );
}

export function Navbar() {
  const pathname = usePathname();
  const router = useRouter();
  const { theme, setTheme } = useTheme();
  const { isLoggedIn, user, accessToken, logout, refreshProfile, updateProfile } = useAuth();
  const { config: siteConfig, loaded: siteLoaded } = useSiteConfig();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const profileRefreshStartedRef = useRef(false);

  // Wait for client-side hydration before rendering auth-dependent UI
  useEffect(() => {
    setMounted(true);
  }, []);

  // Auth store already refreshes on focus/visibility; keep navbar mount refresh idle and one-shot.
  useEffect(() => {
    if (!isLoggedIn || profileRefreshStartedRef.current) return;
    profileRefreshStartedRef.current = true;
    const runRefresh = () => refreshProfile();
    const idleCallback = window.requestIdleCallback?.(runRefresh, { timeout: 2500 });
    const timer = idleCallback === undefined ? window.setTimeout(runRefresh, 1200) : null;
    return () => {
      if (idleCallback !== undefined) window.cancelIdleCallback?.(idleCallback);
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [isLoggedIn, refreshProfile]);

  useEffect(() => {
    if (mounted && isLoggedIn && user?.preferredTheme && theme !== user.preferredTheme) {
      setTheme(user.preferredTheme);
    }
  }, [mounted, isLoggedIn, user?.preferredTheme, theme, setTheme]);

  const handleLogout = () => {
    logout();
    router.push('/');
  };

  const toggleTheme = () => {
    const nextTheme = theme === 'light' ? 'dark' : 'light';
    setTheme(nextTheme);

    if (isLoggedIn && user && accessToken) {
      updateProfile({ preferredTheme: nextTheme });
      fetch('/api/profile/theme', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ theme: nextTheme }),
      }).catch(() => undefined);
    }
  };

  const ThemeToggle = (
    <Button
      variant="ghost"
      size="sm"
      className="h-9 w-9 p-0 text-muted-foreground"
      onClick={toggleTheme}
      title={theme === 'light' ? '切换暗色模式' : '切换浅色模式'}
    >
      {theme === 'light' ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
    </Button>
  );

  return (
    <>
    <header className="sticky top-0 z-50 w-full border-b border-border/50 bg-background/80 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2.5 group">
          <img
            src={siteLoaded && siteConfig.logoUrl ? siteConfig.logoUrl : '/logo.png'}
            alt={siteLoaded ? (siteConfig.siteName || '妙境') : '妙境'}
            className="h-9 w-9 rounded-lg group-hover:opacity-90 transition-opacity"
          />
          <span className="font-serif text-xl font-bold tracking-wide">
            {siteLoaded ? (siteConfig.siteName || '妙境') : '妙境'}
          </span>
        </Link>

        {/* Desktop Nav */}
        <nav className="hidden md:flex items-center gap-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = pathname === item.href || (item.href !== '/' && pathname.startsWith(item.href));
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200',
                  isActive
                    ? 'bg-primary/10 text-primary'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
                )}
              >
                <Icon className="h-4 w-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>

        {/* Right Actions */}
        <div className="hidden md:flex items-center gap-3">
          {mounted && ThemeToggle}
          {!mounted ? (
            // Placeholder during hydration to avoid mismatch
            <div className="h-9 w-48" />
          ) : isLoggedIn && user ? (
            <>
              <Link href="/profile">
                <Button variant="ghost" size="sm" className="gap-2">
                  <UserAvatar avatarUrl={user.avatarUrl} nickname={user.nickname} />
                  {user.nickname}
                  {user.role === 'admin' && (
                    <Shield className="h-3.5 w-3.5 text-primary" />
                  )}
                </Button>
              </Link>
              <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground" onClick={handleLogout}>
                <LogOut className="h-4 w-4" />
              </Button>
            </>
          ) : (
            <>
              <Link href="/auth/login">
                <Button variant="ghost" size="sm" className="gap-2">
                  <LogIn className="h-4 w-4" />
                  登录
                </Button>
              </Link>
              <Link href="/auth/login">
                <Button size="sm" className="gap-2">
                  <Sparkles className="h-4 w-4" />
                  免费开始
                </Button>
              </Link>
            </>
          )}
        </div>

        {/* Mobile Menu Toggle */}
        <button
          className="mobile-menu-button md:hidden p-2 text-muted-foreground hover:text-foreground"
          onClick={() => setMobileOpen(!mobileOpen)}
          aria-label="打开导航菜单"
          aria-expanded={mobileOpen}
          aria-controls="mobile-primary-menu"
        >
          {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>

      {/* Mobile Nav */}
      {mobileOpen && (
        <div id="mobile-primary-menu" className="md:hidden border-t border-border/50 bg-background/95 backdrop-blur-xl">
          <nav className="flex flex-col p-4 gap-1">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setMobileOpen(false)}
                  className={cn(
                    'flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-colors',
                    isActive
                      ? 'bg-primary/10 text-primary'
                      : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
                  )}
                >
                  <Icon className="h-4 w-4" />
                  {item.label}
                </Link>
              );
            })}
            <div className="flex gap-2 mt-4 pt-4 border-t border-border/50">
              {mounted && (
                <Button variant="outline" size="sm" className="px-3" onClick={toggleTheme}>
                  {theme === 'light' ? <Moon className="h-4 w-4 mr-1.5" /> : <Sun className="h-4 w-4 mr-1.5" />}
                  {theme === 'light' ? '暗色' : '浅色'}
                </Button>
              )}
              {!mounted ? (
                <div className="h-9 w-full" />
              ) : isLoggedIn && user ? (
                <>
                  <Link href="/profile" className="flex-1" onClick={() => setMobileOpen(false)}>
                    <Button variant="outline" className="w-full" size="sm">
                      <span className="mr-2">
                        <UserAvatar avatarUrl={user.avatarUrl} nickname={user.nickname} size="sm" />
                      </span>
                      {user.nickname}
                    </Button>
                  </Link>
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1.5 text-muted-foreground"
                    onClick={() => { handleLogout(); setMobileOpen(false); }}
                  >
                    <LogOut className="h-4 w-4" />
                    退出
                  </Button>
                </>
              ) : (
                <>
                  <Link href="/auth/login" className="flex-1" onClick={() => setMobileOpen(false)}>
                    <Button variant="outline" className="w-full" size="sm">登录</Button>
                  </Link>
                  <Link href="/auth/login" className="flex-1" onClick={() => setMobileOpen(false)}>
                    <Button className="w-full" size="sm">免费开始</Button>
                  </Link>
                </>
              )}
            </div>
          </nav>
        </div>
      )}
    </header>
    <nav className="fixed inset-x-0 bottom-0 z-50 grid grid-cols-4 border-t border-border/70 bg-background/92 px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2 backdrop-blur-xl md:hidden mobile-bottom-nav" aria-label="主导航">
      {navItems.map((item) => {
        const Icon = item.icon;
        const isActive = pathname === item.href || (item.href !== '/' && pathname.startsWith(item.href));
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-label={item.label}
            aria-current={isActive ? 'page' : undefined}
            className={cn(
              'mobile-bottom-nav-item flex min-h-12 flex-col items-center justify-center gap-1 rounded-xl text-[11px] font-semibold transition-colors',
              isActive ? 'mobile-bottom-nav-item-active bg-primary/12 text-primary' : 'text-muted-foreground'
            )}
          >
            <Icon className="h-5 w-5" />
            {item.label}
          </Link>
        );
      })}
    </nav>
    </>
  );
}
