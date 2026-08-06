import { create } from 'zustand';
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { User } from '../types/domain';
import { login as apiLogin, logout as apiLogout } from '../services/auth.api';
import { registerAuthExpiredHandler, getStored, setStored, deleteStored } from '../services/api';
import { tokenStore } from './token-store';

const storage = {
  getItem: async (key: string): Promise<string | null> => {
    if (Platform.OS === 'web') return localStorage.getItem(key);
    return SecureStore.getItemAsync(key);
  },
  setItem: async (key: string, value: string): Promise<void> => {
    if (Platform.OS === 'web') { localStorage.setItem(key, value); return; }
    return SecureStore.setItemAsync(key, value);
  },
  deleteItem: async (key: string): Promise<void> => {
    if (Platform.OS === 'web') { localStorage.removeItem(key); return; }
    return SecureStore.deleteItemAsync(key);
  },
};

interface AuthState {
  user: User | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  hydrate: () => Promise<void>;
  clearAuth: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isLoading: true,

  hydrate: async () => {
    try {
      const [accessToken, refreshToken, userJson] = await Promise.all([
        storage.getItem('access_token'),
        storage.getItem('refresh_token'),
        storage.getItem('user'),
      ]);
      console.log('[auth] hydrate | access_token:', accessToken ? 'present' : 'missing', '| user:', userJson ? 'present' : 'missing');
      if (accessToken && refreshToken && userJson) {
        tokenStore.setTokens(accessToken, refreshToken);
        set({ user: JSON.parse(userJson) });
      }
    } catch {
      // ignore hydration errors
    } finally {
      set({ isLoading: false });
    }
  },

  login: async (email, password) => {
    const { access_token, refresh_token, user } = await apiLogin(email, password);
    console.log('[auth] login ok for', user.email);
    await Promise.all([
      storage.setItem('access_token', access_token),
      storage.setItem('refresh_token', refresh_token),
      storage.setItem('user', JSON.stringify(user)),
    ]);
    tokenStore.setTokens(access_token, refresh_token);
    console.log('[auth] tokenStore.access after login:', tokenStore.access?.slice(0, 20));
    set({ user });
  },

  logout: async () => {
    const rt = tokenStore.refresh;
    if (rt) await apiLogout(rt).catch(() => {});
    tokenStore.clear();
    await Promise.all([
      storage.deleteItem('access_token'),
      storage.deleteItem('refresh_token'),
      storage.deleteItem('user'),
    ]);
    set({ user: null });
  },

  // Called by api.ts when refresh token is invalid — clears state without hitting the API
  clearAuth: () => {
    console.log('[auth] clearAuth called — redirecting to login');
    tokenStore.clear();
    storage.deleteItem('access_token').catch(() => {});
    storage.deleteItem('refresh_token').catch(() => {});
    storage.deleteItem('user').catch(() => {});
    set({ user: null });
  },
}));

// When the refresh token expires/fails, force the user back to login
registerAuthExpiredHandler(() => {
  useAuthStore.getState().clearAuth();
});
