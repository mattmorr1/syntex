import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { AgentRunSettings } from '../services/api';

export interface AgentSettings extends AgentRunSettings {
  autoApply: boolean;
}

export const DEFAULT_AGENT_SETTINGS: AgentSettings = { max_steps: 10, max_compiles: 4, thinking: 'low', verify: true, autoApply: false };

interface SettingsState {
  aiModel: 'flash' | 'pro';
  setAiModel: (model: 'flash' | 'pro') => void;
  toggleAiModel: () => void;
  generationMaxTokens: number;
  setGenerationMaxTokens: (tokens: number) => void;
  preferredProvider: string;
  setPreferredProvider: (provider: string) => void;
  agentSettings: Record<string, AgentSettings>;
  setAgentSettings: (projectId: string, patch: Partial<AgentSettings>) => void;
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
      agentSettings: {},
      setAgentSettings: (projectId, patch) => set((state) => ({
        agentSettings: { ...state.agentSettings, [projectId]: { ...DEFAULT_AGENT_SETTINGS, ...state.agentSettings[projectId], ...patch } },
      })),
    }),
    { name: 'syntex-settings' }
  )
);
