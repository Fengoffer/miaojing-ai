import crypto from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getDbClient } from '@/storage/database/local-db';
import { isProductionRuntime } from '@/lib/runtime-env';

const TOKEN_PREFIX = 'mjst.v1';
const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface AuthenticatedUser {
  userId: string;
  role: string;
}

interface SessionPayload {
  sub: string;
  role: string;
  iat: number;
  exp: number;
}

function getSessionSecret(): string {
  if (isProductionRuntime()) {
    const productionSecret = process.env.JWT_SECRET || process.env.DATA_ENCRYPTION_KEY;
    if (!productionSecret) {
      throw new Error('JWT_SECRET or DATA_ENCRYPTION_KEY is required in production');
    }
    return productionSecret;
  }
  return process.env.JWT_SECRET
    || process.env.DATA_ENCRYPTION_KEY
    || process.env.ADMIN_DEFAULT_PASSWORD
    || 'miaojing-local-session-secret';
}

function signPayload(encodedPayload: string): string {
  return crypto
    .createHmac('sha256', getSessionSecret())
    .update(encodedPayload)
    .digest('base64url');
}

export function createSessionToken(userId: string, role: string): string {
  const now = Date.now();
  const payload: SessionPayload = {
    sub: userId,
    role,
    iat: now,
    exp: now + TOKEN_TTL_MS,
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${TOKEN_PREFIX}.${encodedPayload}.${signPayload(encodedPayload)}`;
}

export function verifySessionToken(token: string): AuthenticatedUser | null {
  const parts = token.split('.');
  if (parts.length !== 4 || `${parts[0]}.${parts[1]}` !== TOKEN_PREFIX) return null;

  const encodedPayload = parts[2];
  const signature = parts[3];
  const expected = signPayload(encodedPayload);
  const signatureBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (
    signatureBuffer.length !== expectedBuffer.length
    || !crypto.timingSafeEqual(signatureBuffer, expectedBuffer)
  ) {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8')) as Partial<SessionPayload>;
    if (typeof payload.sub !== 'string' || typeof payload.role !== 'string') return null;
    if (typeof payload.exp !== 'number' || payload.exp < Date.now()) return null;
    if (!/^[0-9a-fA-F-]{36}$/.test(payload.sub)) return null;
    return { userId: payload.sub, role: payload.role };
  } catch {
    return null;
  }
}

export function getBearerToken(request: NextRequest): string {
  const header = request.headers.get('authorization') || '';
  return header.replace(/^Bearer\s+/i, '').trim();
}

export async function getAuthenticatedUser(request: NextRequest): Promise<AuthenticatedUser | null> {
  const claims = verifySessionToken(getBearerToken(request));
  if (!claims) return null;

  const client = await getDbClient();
  try {
    const result = await client.query(
      'SELECT id, role FROM profiles WHERE id = $1 AND is_active = true LIMIT 1',
      [claims.userId],
    );
    if (result.rows.length === 0) return null;
    return {
      userId: result.rows[0].id,
      role: result.rows[0].role || 'user',
    };
  } finally {
    client.release();
  }
}

export async function getAuthenticatedUserId(request: NextRequest): Promise<string | null> {
  const user = await getAuthenticatedUser(request);
  return user?.userId || null;
}

export async function requireAdminUser(request: NextRequest): Promise<AuthenticatedUser | NextResponse> {
  const user = await getAuthenticatedUser(request);
  if (!user) return NextResponse.json({ error: '未登录或无管理员权限' }, { status: 401 });
  if (user.role !== 'admin' && user.role !== 'enterprise_admin') {
    return NextResponse.json({ error: '无管理员权限' }, { status: 403 });
  }
  return user;
}
