import path from 'path';
import { NextRequest, NextResponse } from 'next/server';
import { localStorage } from '@/lib/local-storage';
import { serveWatermarkedDownloadFile } from '@/lib/media-watermark';
import {
  canAccessOriginalMedia,
  resolveMediaWatermarkAccess,
  shouldWatermarkDownloadResponse,
} from '@/lib/media-watermark-policy';
import { fetchPublicHttpUrl } from '@/lib/remote-fetch';

/**
 * Download proxy.
 *
 * Supports:
 * - remote http(s) URLs, fetched server-side to avoid browser CORS failures
 * - same-origin relative URLs
 * - local-storage URLs, read directly from disk with path traversal protection
 */
export async function GET(request: NextRequest) {
  const url = request.nextUrl.searchParams.get('url');
  const filename = sanitizeFilename(
    request.nextUrl.searchParams.get('filename') || 'download',
  );
  const disposition = request.nextUrl.searchParams.get('disposition') === 'inline'
    || request.nextUrl.searchParams.get('inline') === '1'
    ? 'inline'
    : 'attachment';

  if (!url) {
    return NextResponse.json({ error: '缺少 url 参数' }, { status: 400 });
  }

  try {
    const watermarkAccess = await resolveMediaWatermarkAccess(request);
    const localKey = getLocalStorageKey(url);
    if (localKey) {
      return await downloadLocalStorageFile(localKey, filename, disposition, watermarkAccess);
    }

    const targetUrl = resolveDownloadUrl(url, request.nextUrl.origin);
    if (!targetUrl) {
      return NextResponse.json(
        { error: '仅支持 HTTP(S) URL 或站内文件 URL' },
        { status: 400 },
      );
    }

    const response = await fetchPublicHttpUrl(targetUrl, {
      signal: AbortSignal.timeout(60_000),
    });

    if (!response.ok) {
      return NextResponse.json(
        { error: `远程文件获取失败: ${response.status}` },
        { status: response.status },
      );
    }

    const contentType = response.headers.get('content-type') || 'application/octet-stream';
    const body = await response.arrayBuffer();

    return buildDownloadResponse(
      body,
      contentType,
      filename,
      body.byteLength,
      disposition,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : '下载失败';
    console.error('[Download Proxy Error]', msg);
    return NextResponse.json({ error: `下载失败: ${msg}` }, { status: 502 });
  }
}

function getLocalStorageKey(url: string): string | null {
  let pathname = url;
  if (url.startsWith('http://') || url.startsWith('https://')) {
    try {
      pathname = new URL(url).pathname;
    } catch {
      return null;
    }
  }

  const prefix = '/api/local-storage/';
  if (!pathname.startsWith(prefix)) return null;

  try {
    const key = decodeURIComponent(pathname.slice(prefix.length));
    const normalized = path.posix.normalize(key).replace(/^\/+/, '');
    if (!normalized || normalized.startsWith('..') || normalized.includes('/../')) {
      return null;
    }
    return normalized;
  } catch {
    return null;
  }
}

function resolveDownloadUrl(url: string, origin: string): string | null {
  if (url.startsWith('http://') || url.startsWith('https://')) {
    return url;
  }

  if (url.startsWith('/') && !url.startsWith('//')) {
    return `${origin}${url}`;
  }

  return null;
}

async function downloadLocalStorageFile(
  key: string,
  filename: string,
  disposition: 'attachment' | 'inline',
  watermarkAccess: Awaited<ReturnType<typeof resolveMediaWatermarkAccess>>,
) {
  const contentType = getContentType(key);
  const shouldWatermark = shouldWatermarkDownloadResponse(key, contentType, watermarkAccess);
  const mayAccessOriginal = canAccessOriginalMedia(watermarkAccess);

  if (shouldWatermark) {
    try {
      const watermarked = await serveWatermarkedDownloadFile(key, contentType);
      return buildDownloadResponse(
        watermarked.buffer.buffer.slice(
          watermarked.buffer.byteOffset,
          watermarked.buffer.byteOffset + watermarked.buffer.byteLength,
        ) as ArrayBuffer,
        watermarked.contentType,
        filename,
        watermarked.buffer.byteLength,
        disposition,
      );
    } catch {
      return NextResponse.json({ error: '文件不存在' }, { status: 404 });
    }
  }

  const shouldTryObjectRedirect = contentType.startsWith('video/') || !localStorage.fileExists(key);
  if ((mayAccessOriginal || !shouldWatermark) && shouldTryObjectRedirect && await localStorage.objectFileExistsAsync(key)) {
    const objectUrl = localStorage.generateObjectReadUrl(key, 300, {
      contentDisposition: buildContentDisposition(disposition, filename),
      contentType,
    });
    if (objectUrl) {
      const response = NextResponse.redirect(objectUrl, 302);
      response.headers.set('Cache-Control', disposition === 'inline' ? 'private, max-age=60' : 'no-cache');
      return response;
    }
  }

  if (!await localStorage.fileExistsAsync(key)) {
    return NextResponse.json({ error: '文件不存在' }, { status: 404 });
  }

  const fileBuffer = await localStorage.readFileAsync(key);

  return buildDownloadResponse(
    fileBuffer.buffer.slice(
      fileBuffer.byteOffset,
      fileBuffer.byteOffset + fileBuffer.byteLength,
    ) as ArrayBuffer,
    contentType,
    filename,
    fileBuffer.byteLength,
    disposition,
  );
}

function buildDownloadResponse(
  body: ArrayBuffer,
  contentType: string,
  filename: string,
  length: number,
  disposition: 'attachment' | 'inline',
) {
  return new NextResponse(body, {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Content-Disposition': buildContentDisposition(disposition, filename),
      'Content-Length': String(length),
      'Cache-Control': disposition === 'inline'
        ? 'public, max-age=86400, stale-while-revalidate=604800'
        : 'no-cache',
    },
  });
}

function sanitizeFilename(filename: string): string {
  return path.basename(filename).replace(/[\r\n"]/g, '_') || 'download';
}

function buildContentDisposition(disposition: 'attachment' | 'inline', filename: string): string {
  return `${disposition}; filename="${filename}"`;
}

function getContentType(filePath: string): string {
  const extension = filePath.split('.').pop()?.toLowerCase();
  const contentTypeMap: Record<string, string> = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
    gif: 'image/gif',
    svg: 'image/svg+xml',
    mp4: 'video/mp4',
    avi: 'video/x-msvideo',
    mov: 'video/quicktime',
    wmv: 'video/x-ms-wmv',
    webm: 'video/webm',
  };

  return contentTypeMap[extension || ''] || 'application/octet-stream';
}
