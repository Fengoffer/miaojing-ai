export const STREAM_UNSUPPORTED_SYNC_CONFIRM_PREFIX = 'MIAOJING_STREAM_UNSUPPORTED_SYNC_CONFIRM:';
export const SYSTEM_API_BUSY_MESSAGE = '因使用人数较多，模型繁忙，请稍后再试';

function stripStreamFallbackPrefix(message: string): string {
  const trimmed = message.trim();
  if (!trimmed.startsWith(STREAM_UNSUPPORTED_SYNC_CONFIRM_PREFIX)) return trimmed;
  return trimmed.slice(STREAM_UNSUPPORTED_SYNC_CONFIRM_PREFIX.length).trim();
}

export function shouldRetryImageRequestWithoutStream(
  requestBody: Record<string, unknown>,
  upstreamErrorText: string,
): boolean {
  return requestBody.stream !== false
    && upstreamErrorText.trim().startsWith(STREAM_UNSUPPORTED_SYNC_CONFIRM_PREFIX);
}

export function buildSynchronousImageRequestBody(
  requestBody: Record<string, unknown>,
): Record<string, unknown> {
  return {
    ...requestBody,
    stream: false,
  };
}

export function getSystemPollingFailureMessage(lastError: string): string {
  const stripped = stripStreamFallbackPrefix(lastError);
  if (!stripped) return SYSTEM_API_BUSY_MESSAGE;
  if (/^\s*<!doctype html/i.test(stripped) || /^\s*<html[\s>]/i.test(stripped)) {
    return SYSTEM_API_BUSY_MESSAGE;
  }
  return stripped;
}
