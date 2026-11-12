export const themeStorageKey = 'badmark-theme-v1';

export function resolveTheme(stored, prefersDark = false) {
  return ['light', 'dark'].includes(stored) ? stored : prefersDark ? 'dark' : 'light';
}

export function readInitialTheme(target = window) {
  let stored = null;
  try {
    stored = target.localStorage.getItem(themeStorageKey);
  } catch {}
  return resolveTheme(stored, Boolean(target.matchMedia?.('(prefers-color-scheme: dark)').matches));
}

export function applyTheme(theme, root = document.documentElement, storage = window.localStorage) {
  const next = resolveTheme(theme);
  root.dataset.theme = next;
  root.style.colorScheme = next;
  try {
    storage.setItem(themeStorageKey, next);
  } catch {}
  return next;
}
