/**
 * In-memory token cache — single source of truth for api.ts.
 * auth.store.ts writes here on login/logout/hydration so api.ts
 * never has to hit SecureStore asynchronously on every request.
 */
let _accessToken: string | null = null;
let _refreshToken: string | null = null;

export const tokenStore = {
  get access() { return _accessToken; },
  get refresh() { return _refreshToken; },
  setTokens(access: string, refresh: string) {
    _accessToken = access;
    _refreshToken = refresh;
  },
  setAccess(access: string) {
    _accessToken = access;
  },
  clear() {
    _accessToken = null;
    _refreshToken = null;
  },
};
