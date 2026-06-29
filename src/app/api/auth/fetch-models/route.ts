import { NextRequest, NextResponse } from 'next/server';
import { buildCustomApiHeaders, fetchWithRetry, parseCustomApiError } from '@/lib/custom-api-fetch';

interface FetchModelsRequest {
  apiUrl: string;
  apiKey: string;
  provider: string;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { apiUrl, apiKey, provider } = body as FetchModelsRequest;

    if (!apiUrl || !apiKey) {
      return NextResponse.json(
        { success: false, error: '请填写 API 请求地址和 API Key' },
        { status: 400 }
      );
    }

    // Derive the base URL from the apiUrl
    const baseUrl = apiUrl.replace(/\/images\/generations.*/, '').replace(/\/videos\/generations.*/, '').replace(/\/chat\/completions.*/, '').replace(/\/+$/, '');
    const modelsUrl = `${baseUrl}/models`;

    let response: Response;
    try {
      response = await fetchWithRetry(
        modelsUrl,
        {
          method: 'GET',
          headers: buildCustomApiHeaders(apiKey),
        },
        15_000,
        0, // no retry
      );
    } catch (fetchError: unknown) {
      const msg = fetchError instanceof Error ? fetchError.message : '请求失败';
      return NextResponse.json({
        success: false,
        error: `网络错误: ${msg}`,
        suggestion: '请检查 API 地址是否正确、网络是否可达',
      });
    }

    if (response.ok) {
      try {
        const data = await response.json();
        if (Array.isArray(data.data)) {
          const models = data.data.map((m: Record<string, unknown>) => ({
            id: typeof m.id === 'string' ? m.id : '',
            name: typeof m.name === 'string' ? m.name : '',
            description: typeof m.description === 'string' ? m.description : '',
            provider: provider,
          })).filter((m: { id: string }) => m.id);

          return NextResponse.json({
            success: true,
            models: models,
            message: `成功获取 ${models.length} 个模型`,
          });
        } else {
          return NextResponse.json({
            success: false,
            error: 'API 返回的数据格式不正确',
            suggestion: '请检查 API 地址是否正确，确保它支持 /models 端点',
          });
        }
      } catch (parseError) {
        return NextResponse.json({
          success: false,
          error: '解析模型数据失败',
          suggestion: 'API 返回的数据格式可能不正确',
        });
      }
    } else {
      const errorText = await response.text().catch(() => '');
      const isHtml = errorText.trim().startsWith('<!') || errorText.trim().startsWith('<html') || errorText.trim().startsWith('<HTML');

      const parsed = isHtml
        ? { error: parseCustomApiError(response.status, errorText), suggestion: '' }
        : parseApiError(response.status, errorText);

      return NextResponse.json({
        success: false,
        error: parsed.error,
        statusCode: response.status,
        suggestion: parsed.suggestion || getDiagnosticSuggestion(response.status, isHtml),
      });
    }

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : '获取模型列表失败';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

/**
 * Get diagnostic suggestion based on response status and content type
 */
function getDiagnosticSuggestion(statusCode: number, isHtml: boolean): string {
  if (isHtml) {
    if (statusCode === 502 || statusCode === 503 || statusCode === 504) {
      return 'API 代理（如 Cloudflare）返回错误。你的 API 在本地可用但部署环境不可用时，通常是代理防火墙拦截了服务器请求。建议：①检查 API 代理的 WAF/防火墙设置 ②将服务器 IP 加入白名单 ③尝试使用 API 的直连地址（绕过 Cloudflare）';
    }
    if (statusCode === 403) {
      return '代理防火墙拦截了请求。建议：①检查 Cloudflare WAF 规则 ②将服务器 IP 加入白名单 ③使用 API 的直连地址';
    }
    return 'API 返回了错误页面而非 JSON 响应，可能是代理防火墙拦截。建议使用 API 的直连地址（绕过 CDN/代理）';
  }

  const suggestions: Record<number, string> = {
    401: 'API Key 无效或已过期，请检查密钥是否正确',
    403: '账户无权限访问该模型，请检查账户状态',
    404: 'API 地址不正确，请确认完整的请求端点 URL',
    429: '请求频率过高或账户余额不足',
    500: 'API 服务端内部错误，请稍后重试',
    502: 'API 网关错误。可能原因：①API 服务端宕机 ②代理防火墙拦截了服务器 IP',
    503: '服务暂不可用。可能原因：①账户余额不足 ②服务维护中 ③代理限制了服务器IP',
  };

  return suggestions[statusCode] || '';
}

/**
 * Parse common API error status codes and bodies into user-friendly messages
 */
function parseApiError(statusCode: number, errorBody: string): { error: string; suggestion: string } {
  // Delegate HTML detection to shared utility
  const friendlyError = parseCustomApiError(statusCode, errorBody);

  const suggestions: Record<number, string> = {
    401: 'API Key 无效或已过期，请检查密钥是否正确',
    403: '账户无权限访问该模型，请检查账户状态',
    404: 'API 地址不正确，请确认完整的请求端点 URL',
    429: '请求频率过高或账户余额不足',
    500: 'API 服务端内部错误，请稍后重试',
    502: 'API 网关错误。可能原因：①API 服务端宕机 ②代理防火墙拦截了服务器 IP',
    503: '服务暂不可用。可能原因：①账户余额不足 ②服务维护中 ③代理限制了服务器IP',
  };

  return {
    error: friendlyError,
    suggestion: suggestions[statusCode] || '',
  };
}
