import { NextRequest, NextResponse } from 'next/server';
import { buildCustomApiHeaders, fetchWithRetry, parseCustomApiError } from '@/lib/custom-api-fetch';

interface TestApiRequest {
  apiUrl: string;
  apiKey: string;
  modelName: string;
  provider: string;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { apiUrl, apiKey, modelName, provider } = body as TestApiRequest;

    if (!apiUrl || !apiKey) {
      return NextResponse.json(
        { success: false, error: '请填写 API 请求地址和 API Key' },
        { status: 400 }
      );
    }

    // ---- Step 1: Quick connectivity check with a lightweight request ----
    // Try the /models endpoint first (most APIs support this, no cost)
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
        0, // no retry for test - keep it fast
      );
    } catch (fetchError: unknown) {
      // If /models fails with timeout or network error, try the actual endpoint
      if (fetchError instanceof DOMException && fetchError.name === 'AbortError') {
        return await testActualEndpoint(apiUrl, apiKey, modelName || 'gpt-image-2');
      }

      const msg = fetchError instanceof Error ? fetchError.message : '请求失败';

      // Network error - could be DNS, connection refused, or firewall
      if (msg.includes('ECONNREFUSED') || msg.includes('ENOTFOUND') || msg.includes('fetch failed')) {
        return NextResponse.json({
          success: false,
          error: `无法连接到 API 地址: ${msg}`,
          suggestion: '请检查 API 地址是否正确、服务是否运行。常见原因：①地址拼写错误 ②服务未启动 ③DNS 无法解析',
        });
      }

      return NextResponse.json({
        success: false,
        error: `网络错误: ${msg}`,
        suggestion: '请检查 API 地址是否正确、网络是否可达。如果使用了代理（如 Cloudflare），可能代理防火墙拦截了服务器请求',
      });
    }

    // If /models returned successfully, the key is valid
    if (response.ok) {
      let modelInfo = '';
      try {
        const data = await response.json();
        if (Array.isArray(data.data)) {
          const targetModel = modelName || 'gpt-image-2';
          const found = data.data.some((m: Record<string, unknown>) =>
            typeof m.id === 'string' && m.id.includes(targetModel.replace('gpt-image-2', 'dall'))
          );
          modelInfo = found ? `，模型 ${modelName || 'gpt-image-2'} 可用` : `，已连接（共 ${data.data.length} 个模型）`;
        }
      } catch {
        // Ignore parse error, connectivity is confirmed
      }
      return NextResponse.json({
        success: true,
        message: `连接成功${modelInfo}`,
      });
    }

    // /models returned an error - check if it's HTML (Cloudflare block)
    const errorText = await response.text().catch(() => '');
    const isHtml = errorText.trim().startsWith('<!') || errorText.trim().startsWith('<html') || errorText.trim().startsWith('<HTML');

    if (response.status === 404 && !isHtml) {
      // /models not supported (not a Cloudflare error), try actual endpoint
      return await testActualEndpoint(apiUrl, apiKey, modelName || 'gpt-image-2');
    }

    // Auth/permission error or Cloudflare block
    const parsed = isHtml
      ? { error: parseCustomApiError(response.status, errorText), suggestion: '' }
      : parseApiError(response.status, errorText);

    return NextResponse.json({
      success: false,
      error: parsed.error,
      statusCode: response.status,
      suggestion: parsed.suggestion || getDiagnosticSuggestion(response.status, isHtml),
    });

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : '测试连接失败';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

/**
 * Fallback: test by sending a minimal request to the actual generation endpoint
 */
async function testActualEndpoint(apiUrl: string, apiKey: string, modelName: string): Promise<NextResponse> {
  try {
    const response = await fetchWithRetry(
      apiUrl,
      {
        method: 'POST',
        headers: buildCustomApiHeaders(apiKey),
        body: JSON.stringify({
          model: modelName,
          prompt: 'test',
          n: 1,
          size: '1024x1024',
        }),
      },
      15_000,
      0, // no retry for test
    );

    if (response.ok) {
      return NextResponse.json({
        success: true,
        message: `连接成功，模型 ${modelName} 可用`,
      });
    }

    const errorText = await response.text().catch(() => '');
    const parsed = parseApiError(response.status, errorText);

    return NextResponse.json({
      success: false,
      error: parsed.error,
      statusCode: response.status,
      suggestion: parsed.suggestion,
    });
  } catch (fetchError: unknown) {
    if (fetchError instanceof DOMException && fetchError.name === 'AbortError') {
      return NextResponse.json({
        success: false,
        error: '连接超时（15秒），请检查 API 地址是否正确',
        suggestion: '可能原因：①API 地址有误 ②服务响应过慢 ③代理限制了服务器IP访问',
      });
    }

    const msg = fetchError instanceof Error ? fetchError.message : '请求失败';
    return NextResponse.json({
      success: false,
      error: `网络错误: ${msg}`,
      suggestion: '请检查 API 地址和网络连通性',
    });
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
