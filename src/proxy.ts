import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit } from '@/lib/rate-limit';

const PROTECTED_PATHS = [
  '/api/auth/login',
  '/api/auth/register',
  '/api/email/send-register-code',
  '/api/email/send-reset-code',
  '/api/email/send-profile-code',
  '/api/generate/image',
  '/api/generate/video',
  '/api/generate/suggest-prompt',
  '/api/generate/reverse-prompt',
  '/api/download',
  '/api/admin/',
];

const DEFAULT_FRAME_ANCESTORS = [
  "'self'",
  'https://mozhevip.top',
  'https://*.mozhevip.top',
];

function getFrameAncestors(): string[] {
  const configured = process.env.MIAOJING_FRAME_ANCESTORS
    ?.split(/[,\s]+/)
    .map(origin => origin.trim())
    .filter(Boolean);

  return configured && configured.length > 0 ? ["'self'", ...configured] : DEFAULT_FRAME_ANCESTORS;
}

function buildContentSecurityPolicy(request: NextRequest): string {
  const isHttps = request.nextUrl.protocol === 'https:' || request.headers.get('x-forwarded-proto') === 'https';
  const scriptSrc = ["'self'", "'unsafe-inline'", 'blob:'];
  if (process.env.NODE_ENV !== 'production') scriptSrc.push("'unsafe-eval'");

  const frameAncestors = getFrameAncestors();
  const directives = [
    ["default-src", "'self'"],
    ["script-src", ...scriptSrc],
    ["style-src", "'self'", "'unsafe-inline'", 'https://fonts.googleapis.cn'],
    ["img-src", "'self'", 'data:', 'blob:', 'https:', 'http:'],
    ["font-src", "'self'", 'data:', 'https://fonts.gstatic.com', 'https://fonts.gstatic.cn'],
    ["connect-src", "'self'", 'https:', 'http:', 'ws:', 'wss:'],
    ["media-src", "'self'", 'data:', 'blob:', 'https:', 'http:'],
    ["frame-src", "'self'"],
    ["worker-src", "'self'", 'blob:'],
    ['object-src', "'none'"],
    ['base-uri', "'self'"],
    ['form-action', "'self'"],
    ['frame-ancestors', ...frameAncestors],
  ];

  if (isHttps) directives.push(['upgrade-insecure-requests']);

  return directives.map(directive => directive.join(' ')).join('; ');
}

function applySecurityHeaders(response: NextResponse, request: NextRequest): NextResponse {
  const path = request.nextUrl.pathname;

  response.headers.set('Content-Security-Policy', buildContentSecurityPolicy(request));
  response.headers.set('X-Content-Type-Options', 'nosniff');
  if (getFrameAncestors().length === 1) {
    response.headers.set('X-Frame-Options', 'SAMEORIGIN');
  }
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  response.headers.set('X-DNS-Prefetch-Control', 'off');
  response.headers.set('X-Permitted-Cross-Domain-Policies', 'none');
  response.headers.set('Origin-Agent-Cluster', '?1');

  if (request.nextUrl.protocol === 'https:' || request.headers.get('x-forwarded-proto') === 'https') {
    response.headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
  }

  if (path === '/create' || path === '/create/') {
    response.headers.set('Cache-Control', 'no-store, max-age=0, must-revalidate');
  } else if (path.startsWith('/api/local-storage/thumbnails/')) {
    response.headers.set('Cache-Control', 'public, max-age=31536000, immutable');
  } else if (path === '/api/gallery') {
    response.headers.set('Cache-Control', 'private, max-age=30, stale-while-revalidate=120');
  } else if (path.startsWith('/api/')) {
    response.headers.set('Cache-Control', 'no-store');
  }

  return response;
}

function rateLimit(request: NextRequest): NextResponse | null {
  const path = request.nextUrl.pathname;
  if (!PROTECTED_PATHS.some(prefix => path === prefix || path.startsWith(prefix))) return null;

  const method = request.method.toUpperCase();
  const identity = request.headers.get('authorization') || null;

  if (path === '/api/auth/login' || path === '/api/auth/register') {
    return checkRateLimit(request, 'auth');
  }
  if (path.startsWith('/api/email/')) {
    return checkRateLimit(request, 'email');
  }
  if (path.startsWith('/api/generate/')) {
    return method === 'POST' ? checkRateLimit(request, 'generation', identity) : null;
  }
  if (path === '/api/download') {
    return checkRateLimit(request, 'download', identity);
  }
  if (path.startsWith('/api/admin/')) {
    return checkRateLimit(request, 'admin', identity);
  }
  return null;
}

export function proxy(request: NextRequest) {
  const limited = rateLimit(request);
  if (limited) return applySecurityHeaders(limited, request);
  return applySecurityHeaders(NextResponse.next(), request);
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|apple-touch-icon.png|robots.txt).*)',
  ],
};
