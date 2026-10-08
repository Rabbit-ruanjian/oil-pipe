import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { createSafePersistStorage } from './safePersistStorage';

type ThemeMode = 'light' | 'dark' | 'system';

interface ThemeState {
  mode: ThemeMode;
  resolved: 'light' | 'dark';
  setMode: (mode: ThemeMode) => void;
}

function getSystemTheme(): 'light' | 'dark' {
  if (typeof window === 'undefined') return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function resolveTheme(mode: ThemeMode): 'light' | 'dark' {
  return mode === 'system' ? getSystemTheme() : mode;
}

function applyTheme(resolved: 'light' | 'dark') {
  if (typeof document === 'undefined') return;
  document.documentElement.setAttribute('data-theme', resolved);
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set) => ({
      mode: 'system',
      resolved: getSystemTheme(),
      setMode: (mode: ThemeMode) => {
        const resolved = resolveTheme(mode);
        applyTheme(resolved);
        set({ mode, resolved });
      },
    }),
    {
      name: 'theme-storage',
      storage: createSafePersistStorage<ThemeState>(),
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        const resolved = resolveTheme(state.mode);
        applyTheme(resolved);
        state.resolved = resolved;
      },
    }
  )
);

if (typeof window !== 'undefined') {
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    const store = useThemeStore.getState();
    if (store.mode === 'system') {
      const resolved = getSystemTheme();
      applyTheme(resolved);
      useThemeStore.setState({ resolved });
    }
  });
}
