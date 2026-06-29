'use client';

import { useEffect } from 'react';
import { useTheme } from 'next-themes';
import { useAuth } from '@/lib/auth-store';

export function AccountThemeSync() {
  const { isLoggedIn, user } = useAuth();
  const { theme, setTheme } = useTheme();

  useEffect(() => {
    if (!isLoggedIn || !user?.preferredTheme) return;
    if (theme !== user.preferredTheme) {
      setTheme(user.preferredTheme);
    }
  }, [isLoggedIn, user?.preferredTheme, theme, setTheme]);

  return null;
}
