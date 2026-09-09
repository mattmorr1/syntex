import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface SettingsState {
  aiModel: 'flash' | 'pro';
  setAiModel: (model: 'flash' | 'pro') => void;
  toggleAiModel: () => void;
  generationMaxTokens: number;
  setGenerationMaxTokens: (tokens: number) => void;
  preferredProvider: string;
  setPreferredProvider: (provider: string) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      aiModel: 'pro',
      setAiModel: (model) => set({ aiModel: model }),
      toggleAiModel: () => set((state) => ({ aiModel: state.aiModel === 'pro' ? 'flash' : 'pro' })),
      generationMaxTokens: 65536,
      setGenerationMaxTokens: (tokens) => set({ generationMaxTokens: tokens }),
      preferredProvider: 'gemini',
      setPreferredProvider: (provider) => set({ preferredProvider: provider }),
    }),
    { name: 'syntex-settings' }
  )
);
