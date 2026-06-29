import './lib/node-runtime-polyfill';
import { createServer } from 'http';
import { request as httpRequest } from 'http';
import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from 'http';
import { request as httpsRequest } from 'https';
import { parse } from 'url';
import next from 'next';
import { startGenerationJobWorker } from './lib/generation-job-worker';
import {
  isApiRequest,
  isConsoleRequest,
  isConsoleServiceRequest,
  resolveRuntimeRole,
} from './modules/api/runtime-routing';

const dev = process.env.COZE_PROJECT_ENV !== 'PROD';
const hostname = process.env.APP_BIND_HOST || process.env.HOST || '127.0.0.1';
const port = parseInt(process.env.PORT || '5000', 10);
const runtimeRole = resolveRuntimeRole(process.env.APP_RUNTIME_ROLE || process.env.MIAOJING_RUNTIME_ROLE);
const backendInternalUrl = process.env.BACKEND_INTERNAL_URL || 'http://127.0.0.1:5100';
const consoleInternalUrl = process.env.CONSOLE_INTERNAL_URL || 'http://127.0.0.1:5200';
const isFrontendOnly = runtimeRole === 'frontend';
const isBackendOnly = runtimeRole === 'backend';
const isConsoleOnly = runtimeRole === 'console';

function envInt(name: string, fallback: number, min: number, max: number): number {
  const parsed = Number(process.env[name]);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(parsed)));
}

// Create Next.js app
const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

const hopByHopHeaders = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

function stripHopByHopHeaders(headers: IncomingHttpHeaders) {
  const nextHeaders: Record<string, string | string[]> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (!value || hopByHopHeaders.has(key.toLowerCase())) continue;
    nextHeaders[key] = value;
  }
  return nextHeaders;
}

function firstHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function appendForwardedFor(existing: string | string[] | undefined, remoteAddress: string | undefined): string {
  const current = firstHeader(existing);
  if (!remoteAddress) return current || '';
  return current ? `${current}, ${remoteAddress}` : remoteAddress;
}

function proxyRequest(req: IncomingMessage, res: ServerResponse, targetBaseUrl: string, proxyName: string) {
  const target = new URL(req.url || '/', targetBaseUrl);
  const transport = target.protocol === 'https:' ? httpsRequest : httpRequest;
  const headers = stripHopByHopHeaders(req.headers);
  headers.host = target.host;
  headers['x-forwarded-host'] = firstHeader(req.headers['x-forwarded-host']) || firstHeader(req.headers.host) || '';
  headers['x-forwarded-proto'] = firstHeader(req.headers['x-forwarded-proto']) || 'http';
  headers['x-forwarded-for'] = appendForwardedFor(req.headers['x-forwarded-for'], req.socket.remoteAddress);

  const proxyReq = transport(
    {
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port,
      method: req.method,
      path: `${target.pathname}${target.search}`,
      headers,
    },
    proxyRes => {
      res.writeHead(proxyRes.statusCode || 502, stripHopByHopHeaders(proxyRes.headers));
      proxyRes.pipe(res);
    },
  );

  proxyReq.once('error', err => {
    console.error(`[${proxyName}] proxy error:`, err);
    if (!res.headersSent) {
      res.statusCode = 502;
      res.setHeader('content-type', 'application/json');
    }
    res.end(JSON.stringify({ error: 'Upstream service unavailable' }));
  });

  req.pipe(proxyReq);
}

app.prepare().then(() => {
  const server = createServer(async (req, res) => {
    try {
      if (isFrontendOnly && isConsoleRequest(req.method, req.url)) {
        proxyRequest(req, res, consoleInternalUrl, 'frontend-console-proxy');
        return;
      }

      if (isFrontendOnly && isApiRequest(req.url)) {
        proxyRequest(req, res, backendInternalUrl, 'frontend-api-proxy');
        return;
      }

      if (isBackendOnly && isConsoleRequest(req.method, req.url)) {
        res.statusCode = 404;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ error: 'Backend API service does not serve console routes' }));
        return;
      }

      if (isBackendOnly && !isApiRequest(req.url)) {
        res.statusCode = 404;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ error: 'Backend service only serves API routes' }));
        return;
      }

      if (isConsoleOnly && !isConsoleServiceRequest(req.url)) {
        res.statusCode = 404;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ error: 'Console service only serves console routes' }));
        return;
      }

      const parsedUrl = parse(req.url!, true);
      await handle(req, res, parsedUrl);
    } catch (err) {
      console.error('Error occurred handling', req.url, err);
      res.statusCode = 500;
      res.end('Internal server error');
    }
  });
  server.once('error', err => {
    console.error(err);
    process.exit(1);
  });
  server.requestTimeout = envInt('HTTP_REQUEST_TIMEOUT_MS', 190_000, 30_000, 600_000);
  server.headersTimeout = envInt('HTTP_HEADERS_TIMEOUT_MS', 65_000, 10_000, 120_000);
  server.keepAliveTimeout = envInt('HTTP_KEEP_ALIVE_TIMEOUT_MS', 5_000, 1_000, 60_000);
  server.maxHeadersCount = envInt('HTTP_MAX_HEADERS_COUNT', 200, 50, 2000);
  server.listen(port, hostname, () => {
    console.log(
      `> Server listening at http://${hostname}:${port} as ${runtimeRole} / ${
        dev ? 'development' : process.env.COZE_PROJECT_ENV
      }`,
    );
    if (!isFrontendOnly && !isConsoleOnly) {
      startGenerationJobWorker();
    }
  });
});
