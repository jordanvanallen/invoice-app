export type Theme = 'dark' | 'light';
export type TextSize = 'normal' | 'large' | 'xlarge';

const THEME_KEY = 'invoice.theme';
const SIZE_KEY = 'invoice.textSize';

/** Default is dark (the app is used at night). */
export function getTheme(): Theme {
  const t = localStorage.getItem(THEME_KEY);
  return t === 'light' ? 'light' : 'dark';
}

export function getTextSize(): TextSize {
  const s = localStorage.getItem(SIZE_KEY);
  return s === 'large' || s === 'xlarge' ? s : 'normal';
}

export function applyTheme(t: Theme): void {
  document.documentElement.setAttribute('data-theme', t);
  localStorage.setItem(THEME_KEY, t);
}

export function applyTextSize(s: TextSize): void {
  if (s === 'normal') document.documentElement.removeAttribute('data-text-size');
  else document.documentElement.setAttribute('data-text-size', s);
  localStorage.setItem(SIZE_KEY, s);
}
