/**
 * 解析自定义 API 错误信息，返回更友好的提示
 */
export function parseCustomApiError(errorMsg: string): { title: string; suggestion: string } {
  const msg = errorMsg.toLowerCase();

  // 401 / auth errors
  if (msg.includes('401') || msg.includes('unauthorized') || msg.includes('invalid api key') || msg.includes('authentication')) {
    return {
      title: 'API Key 无效',
      suggestion: '请前往 个人中心 → API 管理，检查密钥是否正确',
    };
  }

  // 403 / permission errors
  if (msg.includes('403') || msg.includes('forbidden') || msg.includes('permission')) {
    return {
      title: '无访问权限',
      suggestion: '该 Key 可能不支持当前模型，请检查账户权限',
    };
  }

  // 404 errors
  if (msg.includes('404') || msg.includes('not found')) {
    return {
      title: 'API 地址不正确',
      suggestion: '请前往 个人中心 → API 管理，确认请求地址是否完整',
    };
  }

  // 429 / rate limit
  if (msg.includes('429') || msg.includes('rate limit') || msg.includes('too many')) {
    return {
      title: '请求频率过高',
      suggestion: '请稍等片刻再试，或检查账户余额',
    };
  }

  // 502 / bad gateway (Cloudflare etc.)
  if (msg.includes('502') || msg.includes('bad gateway') || msg.includes('网关错误')) {
    return {
      title: 'API 网关错误',
      suggestion: '可能原因：①API 服务端宕机或重启中 ②代理（如 Cloudflare）无法连接后端 ③代理防火墙拦截了服务器 IP（本地能用但服务器不行）',
    };
  }

  // 503 / service unavailable / no available accounts
  if (msg.includes('503') || msg.includes('no available') || msg.includes('service unavailable') || msg.includes('服务不可用')) {
    return {
      title: '服务暂不可用',
      suggestion: '可能原因：①账户余额不足 ②服务维护中 ③代理限制了服务器IP（本地能用但服务器不行）',
    };
  }

  // 504 / gateway timeout
  if (msg.includes('504') || msg.includes('gateway timeout') || msg.includes('网关超时')) {
    return {
      title: 'API 网关超时',
      suggestion: '可能原因：①API 服务响应过慢 ②代理超时 ③网络不稳定',
    };
  }

  // timeout (general)
  if (msg.includes('timeout') || msg.includes('超时')) {
    return {
      title: '请求超时',
      suggestion: '可能原因：①API 响应过慢 ②网络不稳定 ③代理防火墙拦截了服务器请求',
    };
  }

  // connection error
  if (msg.includes('network') || msg.includes('fetch') || msg.includes('网络') || msg.includes('无法连接') || msg.includes('econnrefused') || msg.includes('enotfound')) {
    return {
      title: '网络连接失败',
      suggestion: '无法连接到 API 服务，请检查 API 地址是否正确、服务是否运行',
    };
  }

  // firewall / IP blocked
  if (msg.includes('防火墙') || msg.includes('拦截') || msg.includes('blocked') || msg.includes('ip')) {
    return {
      title: '请求被拦截',
      suggestion: '代理防火墙可能拦截了服务器请求。你的 API 在本地可用但部署环境不可用时，通常是此原因',
    };
  }

  // Default
  return {
    title: '生成失败',
    suggestion: errorMsg,
  };
}
