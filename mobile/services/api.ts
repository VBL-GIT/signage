import axios, { AxiosInstance, AxiosError } from 'axios';
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { tokenStore } from '../store/token-store';

const BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000';

// Registered by auth.store.ts to force logout when refresh fails
let _onAuthExpired: (() => void) | null = null;
export function registerAuthExpiredHandler(cb: () => void) { _onAuthExpired = cb; }

const api: AxiosInstance = axios.create({
  baseURL: BASE_URL,
  timeout: 15000,
});

// SecureStore helpers — used only for persisting tokens across app restarts (in auth.store hydrate/login/logout)
export async function getStored(key: string): Promise<string | null> {
  if (Platform.OS === 'web') return localStorage.getItem(key);
  return SecureStore.getItemAsync(key);
}

export async function setStored(key: string, value: string): Promise<void> {
  if (Platform.OS === 'web') { localStorage.setItem(key, value); return; }
  return SecureStore.setItemAsync(key, value);
}

export async function deleteStored(key: string): Promise<void> {
  if (Platform.OS === 'web') { localStorage.removeItem(key); return; }
  return SecureStore.deleteItemAsync(key);
}

// Request interceptor — reads token from in-memory tokenStore (fast, synchronous, no SecureStore)
api.interceptors.request.use((config) => {
  const token = tokenStore.access;
  console.log('[api] request to', config.url, '| token:', token ? token.slice(0, 20) + '...' : 'NONE');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

let isRefreshing = false;
let failedQueue: { resolve: (v: string) => void; reject: (e: unknown) => void }[] = [];

function processQueue(error: unknown, token: string | null) {
  failedQueue.forEach((p) => (error ? p.reject(error) : p.resolve(token!)));
  failedQueue = [];
}

api.interceptors.response.use(
  (res) => res,
  async (error: AxiosError) => {
    const original = error.config as typeof error.config & { _retry?: boolean };
    if (error.response?.status !== 401 || original._retry) {
      return Promise.reject(error);
    }
    if (isRefreshing) {
      return new Promise((resolve, reject) => {
        failedQueue.push({ resolve, reject });
      }).then((token) => {
        original.headers!.Authorization = `Bearer ${token}`;
        return api(original);
      });
    }
    original._retry = true;
    isRefreshing = true;
    try {
      const refreshToken = tokenStore.refresh;
      console.log('[api] attempting token refresh | refresh_token:', refreshToken ? 'present' : 'MISSING');
      if (!refreshToken) {
        processQueue(null, null);
        console.log('[api] no refresh token — forcing logout');
        _onAuthExpired?.();
        return Promise.reject(error);
      }
      const { data } = await axios.post(`${BASE_URL}/api/auth/refresh`, { refresh_token: refreshToken });
      console.log('[api] refresh succeeded');
      tokenStore.setAccess(data.access_token);
      await setStored('access_token', data.access_token);
      processQueue(null, data.access_token);
      original.headers!.Authorization = `Bearer ${data.access_token}`;
      return api(original);
    } catch (e) {
      console.log('[api] refresh FAILED — forcing logout. _onAuthExpired registered:', !!_onAuthExpired);
      processQueue(e, null);
      tokenStore.clear();
      await deleteStored('access_token');
      await deleteStored('refresh_token');
      _onAuthExpired?.();
      return Promise.reject(e);
    } finally {
      isRefreshing = false;
    }
  }
);

// Turns any request/axios failure into a clear, human-readable message.
export function apiError(e: unknown): string {
  const ax = e as {
    response?: { status?: number; data?: { error?: string; details?: Record<string, string[]> } };
    code?: string; message?: string;
  };
  const res = ax?.response;

  // No response = network / connectivity / timeout.
  if (!res) {
    if (ax?.code === 'ECONNABORTED') return 'The request timed out. Please try again.';
    return 'Cannot reach the server. Please check your internet connection and try again.';
  }

  const backend = res.data?.error;

  if (backend === 'Validation error') {
    const first = res.data?.details ? Object.values(res.data.details).flat()[0] : undefined;
    return first || 'Please check the form for missing or invalid fields.';
  }
  if (res.status === 401 && backend === 'Invalid credentials') return 'Invalid email or password.';
  if (backend) return backend;

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

export default api;
