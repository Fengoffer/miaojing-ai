export type AppRuntimeRole = 'full' | 'frontend' | 'backend' | 'console';

export function resolveRuntimeRole(value: string | undefined): AppRuntimeRole {
  if (value === 'frontend' || value === 'backend' || value === 'console') {
    return value;
  }
  return 'full';
}

export function isMutatingRequest(method: string | undefined): boolean {
  return method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS';
}

export function isApiRequest(url: string | undefined): boolean {
  return !!url && url.startsWith('/api/');
}

export function isConsoleRequest(method: string | undefined, url: string | undefined): boolean {
  if (!url) return false;
  return (
    url === '/console' ||
    url.startsWith('/console/') ||
    url.startsWith('/api/admin/') ||
    ((url === '/api/announcements' || url.startsWith('/api/announcements?')) && isMutatingRequest(method)) ||
    ((url === '/api/site-config' || url.startsWith('/api/site-config?')) && isMutatingRequest(method))
  );
}

export function isConsoleServiceRequest(url: string | undefined): boolean {
  if (!url) return false;
  return (
    url === '/console' ||
    url.startsWith('/console/') ||
    url.startsWith('/api/admin/') ||
    url === '/api/announcements' ||
    url.startsWith('/api/announcements?') ||
    url === '/api/site-config' ||
    url.startsWith('/api/site-config?')
  );
}
