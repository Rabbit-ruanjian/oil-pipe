import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { UserInfo } from '../types';
import { createSafePersistStorage } from './safePersistStorage';

export const USER_STORAGE_KEY = 'user-storage';

const EMPTY_USER_STATE = {
  token: null,
  userInfo: null,
  isLoggedIn: false,
} as const;

interface UserState {
  token: string | null;
  userInfo: UserInfo | null;
  isLoggedIn: boolean;
  setToken: (token: string) => void;
  setUserInfo: (info: UserInfo) => void;
  logout: () => void;
}

type PersistedUserState = Pick<UserState, 'token' | 'userInfo' | 'isLoggedIn'>;

export const useUserStore = create<UserState>()(
  persist(
    (set) => ({
      ...EMPTY_USER_STATE,

      setToken: (token: string) =>
        set({ token, isLoggedIn: true }),

      setUserInfo: (info: UserInfo) =>
        set({ userInfo: info }),

      logout: () =>
        set(EMPTY_USER_STATE),
    }),
    {
      name: USER_STORAGE_KEY,
      storage: createSafePersistStorage<PersistedUserState>(),
      partialize: (state) => ({
        token: state.token,
        userInfo: state.userInfo,
        isLoggedIn: state.isLoggedIn,
      }),
    }
  )
);

export function clearPersistedUserState() {
  useUserStore.setState(EMPTY_USER_STATE);
  if (typeof window !== 'undefined') {
    window.localStorage.removeItem(USER_STORAGE_KEY);
  }
}
