import {useSyncExternalStore} from 'react';

const key = 'trading-desk.appearance';
const listeners = new Set();
const subscribe = listener => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
const getTheme = () => document.documentElement.dataset.theme || 'light';
const printMedia = window.matchMedia('print');
const getChartTheme = () => printMedia.matches ? 'light' : getTheme();

function notify() {
  for (const listener of listeners) listener();
}

function applyTheme(value) {
  const theme = value === 'dark' ? 'dark' : 'light';
  if (document.documentElement.dataset.theme === theme) return;
  document.documentElement.dataset.theme = theme;
  notify();
}

export function initializeAppearance() {
  let saved;
  try { saved = window.localStorage.getItem(key); } catch { /* Storage can be disabled. */ }
  applyTheme(saved);
  printMedia.addEventListener('change', notify);
  window.addEventListener('storage', event => {
    if (event.key === key || event.key === null) {
      try {
        if (event.storageArea === window.localStorage) applyTheme(window.localStorage.getItem(key));
      } catch { /* Keep the current appearance when storage is unavailable. */ }
    }
  });
}

export function setAppearance(theme) {
  applyTheme(theme);
  try { window.localStorage.setItem(key, getTheme()); } catch { /* The switch still works for this visit. */ }
}

export const useAppearance = () => useSyncExternalStore(subscribe, getTheme);

const palettes = new Map();
// Canvas renderers require resolved colors. Read the same CSS tokens as the desk once per theme.
export function useChartPalette() {
  const theme = useSyncExternalStore(subscribe, getChartTheme);
  if (!palettes.has(theme)) {
    const style = getComputedStyle(document.documentElement);
    const names = ['bg', 'panel', 'text', 'muted', 'border', 'primary', 'selection', 'green', 'red', 'amber',
      'on-primary', 'chart-grid', 'chart-axis', 'chart-estimate', 'chart-vwap', 'chart-ema', 'chart-volume-up', 'chart-volume-down'];
    palettes.set(theme, Object.fromEntries(names.map(name => [
      name.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase()), style.getPropertyValue('--' + name).trim()
    ])));
  }
  return palettes.get(theme);
}
