const DEFAULT_API_BASE_URL = '';

function apiBaseUrl() {
  const configured = import.meta.env.VITE_API_BASE_URL?.trim();
  return (configured || DEFAULT_API_BASE_URL).replace(/\/+$/, '');
}

function joinPath(path: string) {
  return `${apiBaseUrl()}${path}`;
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = init?.body ? { 'Content-Type': 'application/json', ...init.headers } : init?.headers;
  const response = await fetch(joinPath(path), { credentials: 'include', ...init, headers });
  if (!response.ok) {
    let detail = `${response.status} ${response.statusText}`;
    try {
      const body = (await response.json()) as { detail?: string };
      if (body.detail) detail = body.detail;
    } catch {
      // 保留 HTTP 状态作为兜底错误。
    }
    throw new Error(detail);
  }
  return response.json() as Promise<T>;
}

export interface AuthUser {
  username: string;
  role: 'admin' | string;
  expiresAt?: number;
}

export interface AuthSessionResponse {
  authenticated: boolean;
  user: AuthUser | null;
}

export function fetchAuthSession() {
  return requestJson<AuthSessionResponse>('/api/auth/session');
}

export function loginAdmin(username: string, password: string) {
  return requestJson<AuthSessionResponse>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });
}

export function logoutAdmin() {
  return requestJson<AuthSessionResponse>('/api/auth/logout', {
    method: 'POST',
  });
}
