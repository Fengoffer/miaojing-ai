import { NextRequest, NextResponse } from 'next/server';
import { getDbClient } from '@/storage/database/local-db';
import { getUserMembershipTier, listSystemApis } from '@/lib/server-api-config';
import { getAuthenticatedUserId, getBearerToken } from '@/lib/session-auth';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';

const MODEL_CONFIG_RESPONSE_HEADERS = {
  'Cache-Control': 'private, no-store, max-age=0, must-revalidate',
  Pragma: 'no-cache',
  Expires: '0',
  'Surrogate-Control': 'no-store',
  Vary: 'Authorization, Cookie',
};

function modelConfigJson(body: unknown, init?: ResponseInit) {
  const response = NextResponse.json(body, init);
  for (const [name, value] of Object.entries(MODEL_CONFIG_RESPONSE_HEADERS)) {
    response.headers.set(name, value);
  }
  return response;
}

function mapProvider(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    name: String(row.name || ''),
    defaultApiUrl: String(row.default_api_url || ''),
    defaultModel: String(row.default_model || ''),
    type: String(row.type || 'image'),
    website: (row.website as string | null) || null,
    isActive: row.is_active !== false,
    sortOrder: Number(row.sort_order || 0),
  };
}

function mapRecommendation(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    modelName: String(row.model_name || ''),
    displayName: String(row.display_name || row.model_name || ''),
    type: String(row.type || 'image'),
    providerId: (row.provider_id as string | null) || null,
    isActive: row.is_active !== false,
    sortOrder: Number(row.sort_order || 0),
  };
}

export async function GET(request: NextRequest) {
  try {
    const userId = await getAuthenticatedUserId(request);
    if (!userId) {
      if (getBearerToken(request)) {
        return modelConfigJson({ error: '登录状态已过期，请重新登录' }, { status: 401 });
      }
      return modelConfigJson({ providers: [], recommendations: [], systemApis: [] });
    }

    const membershipTier = await getUserMembershipTier(userId);
    const client = await getDbClient();
    try {
      const providers = await client.query(
        `SELECT id, name, default_api_url, default_model, type, website, is_active, sort_order
         FROM api_providers
         WHERE is_active = true
         ORDER BY sort_order ASC, name ASC`
      );
      const recommendations = await client.query(
        `SELECT id, model_name, display_name, type, provider_id, is_active, sort_order
         FROM model_recommendations
         WHERE is_active = true
         ORDER BY type ASC, sort_order ASC, model_name ASC`
      );

      return modelConfigJson({
        providers: providers.rows.map(mapProvider),
        recommendations: recommendations.rows.map(mapRecommendation),
        systemApis: await listSystemApis(false, { defaultOnly: true, userTier: membershipTier, collapseDefaultModels: true }),
      });
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('[model-config] GET error:', err);
    return modelConfigJson({ providers: [], recommendations: [], systemApis: [] });
  }
}
