export type ThemePref = 'system' | 'light' | 'dark';
const KEY = 'signage-theme';

export function getTheme(): ThemePref {
  try { const v = localStorage.getItem(KEY); if (v === 'light' || v === 'dark') return v; } catch { /* ignore */ }
  return 'system';
}

/** "system" removes the override so the prefers-color-scheme media query decides. */
export function applyTheme(pref: ThemePref) {
  const el = document.documentElement;
  if (pref === 'system') el.removeAttribute('data-theme'); else el.setAttribute('data-theme', pref);
  try { if (pref === 'system') localStorage.removeItem(KEY); else localStorage.setItem(KEY, pref); } catch { /* ignore */ }
}
