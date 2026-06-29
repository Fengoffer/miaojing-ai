'use client';

import { useEffect, useRef } from 'react';

type IdleCallbackHandle = ReturnType<Window['requestIdleCallback']>;

/**
 * Tracks site visits by calling /api/site-stats on page load.
 * Uses sessionStorage to count only once per browser session.
 */
export function VisitTracker() {
  const tracked = useRef(false);

  useEffect(() => {
    if (tracked.current) return;
    tracked.current = true;

    // Only track once per session
    if (typeof window !== 'undefined' && sessionStorage.getItem('visit_tracked')) {
      return;
    }

    const trackVisit = () => {
      fetch('/api/site-stats', { method: 'POST', keepalive: true })
        .then(() => {
          sessionStorage.setItem('visit_tracked', '1');
        })
        .catch(() => { /* non-critical */ });
    };

    let idleHandle: IdleCallbackHandle | null = null;
    let timer: number | null = null;
    if (typeof window.requestIdleCallback === 'function') {
      idleHandle = window.requestIdleCallback(trackVisit, { timeout: 2500 });
    } else {
      timer = window.setTimeout(trackVisit, 1200);
    }
    return () => {
      if (idleHandle !== null) window.cancelIdleCallback?.(idleHandle);
      if (timer !== null) window.clearTimeout(timer);
    };
  }, []);

  return null;
}
