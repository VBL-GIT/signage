import axios from 'axios';

const baseURL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

export const api = axios.create({ baseURL });

const ACCESS = 'access_token';
const REFRESH = 'refresh_token';
const USER = 'user';

export const tokens = {
  get access() { return localStorage.getItem(ACCESS); },
  get refresh() { return localStorage.getItem(REFRESH); },
  set(access: string, refresh: string) {
    localStorage.setItem(ACCESS, access);
    localStorage.setItem(REFRESH, refresh);
  },
  clear() {
    localStorage.removeItem(ACCESS);
    localStorage.removeItem(REFRESH);
    localStorage.removeItem(USER);
  },
};

export const userStorage = {
  get() { const v = localStorage.getItem(USER); return v ? JSON.parse(v) : null; },
  set(u: unknown) { localStorage.setItem(USER, JSON.stringify(u)); },
};

let onAuthExpired: (() => void) | null = null;
export function setOnAuthExpired(fn: () => void) { onAuthExpired = fn; }

api.interceptors.request.use((config) => {
  const t = tokens.access;
  if (t) config.headers.Authorization = `Bearer ${t}`;
  return config;
});

let refreshing: Promise<string | null> | null = null;

async function doRefresh(): Promise<string | null> {
  const rt = tokens.refresh;
  if (!rt) return null;
  try {
    const { data } = await axios.post(`${baseURL}/api/auth/refresh`, { refresh_token: rt });
    localStorage.setItem(ACCESS, data.access_token);
    return data.access_token as string;
  } catch {
    return null;
  }
}

api.interceptors.response.use(
  (r) => r,
  async (error) => {
    const original = error.config;
    if (error.response?.status === 401 && !original._retry) {
      original._retry = true;
      refreshing = refreshing ?? doRefresh();
      const newToken = await refreshing;
      refreshing = null;
      if (newToken) {
        original.headers.Authorization = `Bearer ${newToken}`;
        return api(original);
      }
      tokens.clear();
      onAuthExpired?.();
    }
    return Promise.reject(error);
  }
);

// Turns any request failure into a clear, human-readable message.
export function apiError(e: unknown): string {
  const ax = e as {
    response?: { status?: number; data?: { error?: string; details?: Record<string, string[]> } };
    code?: string; message?: string;
  };
  const res = ax?.response;

  // No response at all = network / connectivity / timeout.
  if (!res) {
    if (ax?.code === 'ECONNABORTED') return 'The request timed out. Please try again.';
    return 'Cannot reach the server. Please check your internet connection and try again.';
  }

  const backend = res.data?.error;

  // Validation errors: surface the first specific field message.
  if (backend === 'Validation error') {
    const first = res.data?.details ? Object.values(res.data.details).flat()[0] : undefined;
    return first || 'Please check the form for missing or invalid fields.';
  }

  // Friendlier login message.
  if (res.status === 401 && backend === 'Invalid credentials') return 'Invalid email or password.';

  // Prefer the backend's own (already human-readable) message.
  if (backend) return backend;

  // Fallbacks by status code.
  switch (res.status) {
    case 401: return 'Your session has expired. Please log in again.';
    case 403: return "You don't have permission to do that.";
    case 404: return 'The requested item was not found.';
    case 409: return 'That conflicts with an existing record.';
    case 429: return 'Too many requests. Please wait a moment and try again.';
    case 500: return 'Something went wrong on the server. Please try again.';
    default: return ax?.message || 'Something went wrong. Please try again.';
  }
}
