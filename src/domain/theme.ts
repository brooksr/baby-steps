export type Theme = 'light' | 'dark';

const THEME_STORAGE_KEY = 'babysteps.theme';
const THEME_COLORS: Record<Theme, string> = { dark: '#0f1620', light: '#74bdf2' };

function safeStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** Stored choice if any, otherwise follow the device's system preference. */
export function getInitialTheme(): Theme {
  const stored = safeStorage()?.getItem(THEME_STORAGE_KEY);
  if (stored === 'light' || stored === 'dark') {
    return stored;
  }
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/** Apply the theme to the document and persist the choice. */
export function applyTheme(theme: Theme) {
  document.documentElement.setAttribute('data-theme', theme);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLORS[theme]);
  safeStorage()?.setItem(THEME_STORAGE_KEY, theme);
}
