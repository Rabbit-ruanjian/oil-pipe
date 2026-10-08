import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { createSafePersistStorage } from './safePersistStorage';

export const CALCULATION_LINK_STORAGE_KEY = 'calculation-link-storage';

export type LinkedCalculationType = 'HYDRAULIC' | 'OPTIMIZATION' | 'SENSITIVITY';

export interface LinkedCalculationRecord {
  calcType: LinkedCalculationType;
  projectId: number | null;
  projectName: string | null;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  updatedAt: string;
}

interface CalculationLinkState {
  latestByType: Partial<Record<LinkedCalculationType, LinkedCalculationRecord>>;
  lastProjectId: number | null;
  lastProjectName: string | null;
  linkCalculation: (record: LinkedCalculationRecord) => void;
  clearLinkedCalculations: () => void;
}

type PersistedCalculationLinkState = Pick<
  CalculationLinkState,
  'latestByType' | 'lastProjectId' | 'lastProjectName'
>;

const EMPTY_LINK_STATE: PersistedCalculationLinkState = {
  latestByType: {},
  lastProjectId: null,
  lastProjectName: null,
};

export const useCalculationLinkStore = create<CalculationLinkState>()(
  persist(
    (set) => ({
      ...EMPTY_LINK_STATE,

      linkCalculation: (record) =>
        set((state) => ({
          latestByType: {
            ...state.latestByType,
            [record.calcType]: record,
          },
          lastProjectId: record.projectId ?? state.lastProjectId,
          lastProjectName: record.projectName ?? state.lastProjectName,
        })),

      clearLinkedCalculations: () => set(EMPTY_LINK_STATE),
    }),
    {
      name: CALCULATION_LINK_STORAGE_KEY,
      storage: createSafePersistStorage<PersistedCalculationLinkState>(),
      partialize: (state) => ({
        latestByType: state.latestByType,
        lastProjectId: state.lastProjectId,
        lastProjectName: state.lastProjectName,
      }),
    },
  ),
);
