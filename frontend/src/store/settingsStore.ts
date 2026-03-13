import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface SettingsState {
  aiModel: 'flash' | 'pro';
  setAiModel: (model: 'flash' | 'pro') => void;
  toggleAiModel: () => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      aiModel: 'pro',
      setAiModel: (model) => set({ aiModel: model }),
      toggleAiModel: () => set((state) => ({ aiModel: state.aiModel === 'pro' ? 'flash' : 'pro' })),
    }),
    { name: 'syntex-settings' }
  )
);
