let csrfToken = '';
export function setCsrfToken(token: string) { csrfToken = token; }

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

export async function request(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (init.body && !(init.body instanceof FormData)) headers.set('Content-Type', 'application/json');
  if (init.method && !['GET', 'HEAD'].includes(init.method.toUpperCase()) && csrfToken) headers.set('x-csrf-token', csrfToken);
  let response: Response;
  try { response = await fetch(`/api${path}`, { ...init, headers, credentials: 'same-origin', cache: 'no-store' }); }
  catch { throw new ApiError(0, 'NETWORK_ERROR', '无法连接服务，请检查网络后重试。'); }
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    const error = data.error || data;
    const message = Array.isArray(error.message) ? error.message.join('；') : error.message;
    throw new ApiError(response.status, error.code || 'REQUEST_FAILED', message || `请求失败（${response.status}），请稍后重试。`);
  }
  return response;
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await request(path, init);
  return response.status === 204 ? undefined as T : response.json();
}
export const json = (method: string, body?: unknown): RequestInit => ({ method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
export function errorMessage(error: unknown) {
  if (error instanceof ApiError && error.code === 'AI_CUSTOM_KEY_INVALID') return '您的 API Key 无效，请检查后重试';
  return error instanceof Error ? error.message : '操作失败，请重试。';
}
