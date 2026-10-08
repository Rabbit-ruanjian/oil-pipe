import type { PersistStorage, StorageValue } from 'zustand/middleware';

function getLocalStorage() {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function createSafePersistStorage<T>(): PersistStorage<T> {
  return {
    getItem: (name) => {
      const storage = getLocalStorage();
      if (!storage) {
        return null;
      }

      const raw = storage.getItem(name);
      if (!raw) {
        return null;
      }

      try {
        return JSON.parse(raw) as StorageValue<T>;
      } catch {
        storage.removeItem(name);
        return null;
      }
    },

    setItem: (name, value) => {
      const storage = getLocalStorage();
      if (!storage) {
        return;
      }

      try {
        storage.setItem(name, JSON.stringify(value));
      } catch {
        // Ignore storage write failures so app boot can continue.
      }
    },

    removeItem: (name) => {
      const storage = getLocalStorage();
      if (!storage) {
        return;
      }

      try {
        storage.removeItem(name);
      } catch {
        // Ignore storage cleanup failures.
      }
    },
  };
}
