import { NextRequest, NextResponse } from 'next/server';
import { isProductionRuntime } from '@/lib/runtime-env';

type BucketName = 'auth' | 'email' | 'generation' | 'download' | 'admin';

type BucketRule = {
  windowMs: number;
  max: number;
};

type BucketState = {
  resetAt: number;
  count: number;
};

const RULES: Record<BucketName, BucketRule> = {
  auth: { windowMs: 60_000, max: 10 },
  email: { windowMs: 60_000, max: 6 },
  generation: { windowMs: 60_000, max: 20 },
  download: { windowMs: 60_000, max: 60 },
  admin: { windowMs: 60_000, max: 120 },
};

const buckets = new Map<string, BucketState>();
let lastCleanupAt = 0;

function envInt(name: string, fallback: number, min: number, max: number): number {
  const parsed = Number(process.env[name]);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(parsed)));
}

function ruleFor(bucket: BucketName): BucketRule {
  const rule = RULES[bucket];
  const prefix = `RATE_LIMIT_${bucket.toUpperCase()}`;
  return {
    windowMs: envInt(`${prefix}_WINDOW_SECONDS`, Math.ceil(rule.windowMs / 1000), 1, 3600) * 1000,
    max: envInt(`${prefix}_MAX`, rule.max, 1, 10000),
  };
}

function clientIp(request: NextRequest): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim().slice(0, 64);
  return (
    request.headers.get('x-real-ip')
    || request.headers.get('cf-connecting-ip')
    || 'unknown'
  ).slice(0, 64);
}

function stableHash(value: string): string {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function cleanupExpired(now: number): void {
  if (now - lastCleanupAt < 60_000) return;
  lastCleanupAt = now;
  for (const [key, state] of buckets.entries()) {
    if (state.resetAt <= now) buckets.delete(key);
  }
}

export function checkRateLimit(
  request: NextRequest,
  bucket: BucketName,
  identity?: string | null,
): NextResponse | null {
  if (!isProductionRuntime() && process.env.ENABLE_DEV_RATE_LIMIT !== 'true') {
    return null;
  }

  const rule = ruleFor(bucket);
  const now = Date.now();
  cleanupExpired(now);

  const key = `${bucket}:${stableHash(identity || clientIp(request))}`;
  const state = buckets.get(key);
  if (!state || state.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + rule.windowMs });
    return null;
  }

  state.count += 1;
  if (state.count <= rule.max) return null;

  const retryAfter = Math.max(1, Math.ceil((state.resetAt - now) / 1000));
  return NextResponse.json(
    { error: `请求过于频繁，请 ${retryAfter} 秒后再试` },
    {
      status: 429,
      headers: {
        'Retry-After': String(retryAfter),
        'Cache-Control': 'no-store',
      },
    },
  );
}
