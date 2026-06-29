'use client';

import { AlertTriangle } from 'lucide-react';

export interface GenerationErrorState {
  message: string;
  time: string;
}

export function createGenerationError(message: string): GenerationErrorState {
  return {
    message,
    time: new Date().toISOString(),
  };
}

function explainGenerationError(message: string): string {
  const normalized = message.toLowerCase();

  if (
    /\b401\b/.test(normalized) ||
    normalized.includes('unauthorized') ||
    normalized.includes('invalid api key') ||
    normalized.includes('apikey') ||
    normalized.includes('api key') ||
    normalized.includes('token')
  ) {
    return 'API 密钥无效、已过期，或当前密钥没有通过认证。请检查自定义 API 密钥是否填写正确。';
  }

  if (
    /\b403\b/.test(normalized) ||
    normalized.includes('forbidden') ||
    normalized.includes('permission') ||
    normalized.includes('access denied')
  ) {
    return '当前 API 密钥没有访问该模型或接口的权限。请确认供应商后台是否已开通对应模型。';
  }

  if (
    /\b429\b/.test(normalized) ||
    normalized.includes('rate limit') ||
    normalized.includes('too many requests') ||
    normalized.includes('requests too frequent')
  ) {
    return '请求过于频繁或触发了上游限流。请稍后再试，或检查供应商的并发和频率限制。';
  }

  if (
    normalized.includes('quota') ||
    normalized.includes('balance') ||
    normalized.includes('insufficient') ||
    normalized.includes('billing') ||
    normalized.includes('credit')
  ) {
    return '上游账号额度、余额或计费状态异常。请检查供应商账号余额、套餐额度或账单状态。';
  }

  if (
    normalized.includes('model') &&
    (normalized.includes('not found') ||
      normalized.includes('does not exist') ||
      normalized.includes('invalid') ||
      normalized.includes('unsupported'))
  ) {
    return '模型名称可能填写错误，或该 API 密钥尚未开通当前模型。请检查模型名称和供应商模型权限。';
  }

  if (
    normalized.includes('timeout') ||
    normalized.includes('timed out') ||
    normalized.includes('abort') ||
    normalized.includes('超时') ||
    normalized.includes('請求逾時') ||
    /\b504\b/.test(normalized)
  ) {
    return '请求上游服务超时。通常表示上游模型仍在生成但响应时间超过了平台等待时间，或供应商接口当前响应过慢。可以稍后重试，或降低分辨率、生成数量后再试。';
  }

  if (
    /\b413\b/.test(normalized) ||
    normalized.includes('request entity too large') ||
    normalized.includes('payload too large') ||
    normalized.includes('content too large') ||
    normalized.includes('参考图请求体过大')
  ) {
    return '图生图请求里的参考图内容超过了上游接口网关限制。平台不会压缩用户图片；请更换更小的参考图，或让 API 供应商调高图生图上传限制。';
  }

  if (
    /\b500\b/.test(normalized) ||
    /\b502\b/.test(normalized) ||
    /\b503\b/.test(normalized) ||
    normalized.includes('server error') ||
    normalized.includes('bad gateway') ||
    normalized.includes('service unavailable')
  ) {
    return '上游服务返回异常。通常不是本平台输入框的问题，建议稍后重试或检查供应商服务状态。';
  }

  if (
    normalized.includes('network') ||
    normalized.includes('fetch failed') ||
    normalized.includes('enotfound') ||
    normalized.includes('econnrefused') ||
    normalized.includes('connection refused')
  ) {
    return '服务器无法连接到上游 API 地址。请检查 API 请求地址、网络连通性和供应商域名是否可访问。';
  }

  if (
    normalized.includes('image') ||
    normalized.includes('base64') ||
    normalized.includes('format') ||
    normalized.includes('unsupported') ||
    normalized.includes('file size')
  ) {
    return '上传图片的格式、大小、内容或编码可能不符合上游要求。请尝试更换图片或压缩后重新上传。';
  }

  return '上游服务返回了未分类错误。请优先检查 API 地址、模型名称、密钥权限、账号额度和本次请求参数。';
}

export function GenerationErrorPanel({ error }: { error: GenerationErrorState }) {
  const explanation = explainGenerationError(error.message);

  return (
    <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-destructive">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
        <div className="min-w-0 space-y-3">
          <div>
            <p className="text-sm font-medium">生成失败</p>
            <p className="text-xs text-destructive/80">
              报错时间：{new Date(error.time).toLocaleString('zh-CN', { hour12: false })}
            </p>
          </div>
          <div>
            <p className="mb-1 text-xs font-medium text-destructive/80">上游原始报错：</p>
            <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">
              {error.message}
            </p>
          </div>
          <div className="rounded-md border border-destructive/20 bg-background/35 p-3">
            <p className="mb-1 text-xs font-medium text-destructive/80">中文解释：</p>
            <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">
              {explanation}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
