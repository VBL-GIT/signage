import { create } from 'zustand';
import type { User, Privilege } from '../types';
import { login as apiLogin, logoutApi, getMe } from '../api';
import { tokens, userStorage, setOnAuthExpired } from '../api/client';

interface AuthState {
  user: User | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshPrivileges: () => Promise<void>;
  clear: () => void;
}

export const useAuth = create<AuthState>((set, get) => ({
  user: userStorage.get(),
  login: async (email, password) => {
    const { access_token, refresh_token, user } = await apiLogin(email, password);
    tokens.set(access_token, refresh_token);
    userStorage.set(user);
    set({ user });
  },
  logout: async () => {
    const rt = tokens.refresh;
    if (rt) await logoutApi(rt);
    tokens.clear();
    set({ user: null });
  },
  // Re-fetch live privileges (custom-role edits take effect without re-login).
  refreshPrivileges: async () => {
    const u = get().user;
    if (!u) return;
    try {
      const me = await getMe();
      const merged = { ...u, privileges: me.privileges };
      userStorage.set(merged);
      set({ user: merged });
    } catch { /* ignore */ }
  },
  clear: () => { tokens.clear(); set({ user: null }); },
}));

/** Hook: does the current user hold a privilege? rjcorp_admin implicitly holds all. */
export function useHasPrivilege() {
  const user = useAuth((s) => s.user);
  return (priv: Privilege) =>
    user?.role === 'rjcorp_admin' || !!user?.privileges?.includes(priv);
}

setOnAuthExpired(() => useAuth.getState().clear());
