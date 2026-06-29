import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUserId } from '@/lib/session-auth';
import {
  isTrustedInternalGenerationRequest,
  isUuid,
} from '@/lib/server-api-config';

type GenerationRouteConfig = {
  customApiKeyId?: string;
  systemApiId?: string;
  apiKey?: string;
} | undefined;

export type GenerationRouteAccess = {
  trustedInternalRequest: boolean;
  trustedUserId: string | null;
  generationJobId: string | null;
  authenticatedUserId: string | null;
  response: NextResponse | null;
};

export async function enforceGenerationRouteAccess(
  request: NextRequest,
  config: GenerationRouteConfig,
): Promise<GenerationRouteAccess> {
  const trustedInternalRequest = isTrustedInternalGenerationRequest(request);
  const trustedUserId = trustedInternalRequest
    ? request.headers.get('x-miaojing-generation-user-id')
    : null;
  const generationJobId = trustedInternalRequest
    ? request.headers.get('x-miaojing-generation-job-id')
    : null;

  if (trustedInternalRequest) {
    return {
      trustedInternalRequest,
      trustedUserId,
      generationJobId,
      authenticatedUserId: null,
      response: null,
    };
  }

  const hasDirectSystemOrSecretConfig = Boolean(config?.systemApiId || config?.apiKey);
  if (hasDirectSystemOrSecretConfig) {
    return {
      trustedInternalRequest,
      trustedUserId: null,
      generationJobId: null,
      authenticatedUserId: null,
      response: NextResponse.json(
        { error: '普通生成请求请通过任务队列提交' },
        { status: 403 },
      ),
    };
  }

  if (isUuid(config?.customApiKeyId)) {
    const authenticatedUserId = await getAuthenticatedUserId(request);
    if (authenticatedUserId) {
      return {
        trustedInternalRequest,
        trustedUserId: null,
        generationJobId: null,
        authenticatedUserId,
        response: null,
      };
    }
    return {
      trustedInternalRequest,
      trustedUserId: null,
      generationJobId: null,
      authenticatedUserId: null,
      response: NextResponse.json({ error: '请先登录后再使用自定义 API' }, { status: 401 }),
    };
  }

  return {
    trustedInternalRequest,
    trustedUserId: null,
    generationJobId: null,
    authenticatedUserId: null,
    response: NextResponse.json(
      { error: '普通生成请求请通过任务队列提交' },
      { status: 403 },
    ),
  };
}
