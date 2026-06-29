'use client';

import { useAdminConfig } from '@/lib/admin-store';
import type { ReactNode } from 'react';

/** Only renders children when admin has enabled the billing plan section */
export function BillingPlanGuard({ children }: { children: ReactNode }) {
  const { config } = useAdminConfig();
  if (!config.showBillingPlan) return null;
  return <>{children}</>;
}
