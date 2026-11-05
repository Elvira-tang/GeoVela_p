import { create } from 'zustand'
import type { WebAgentConfig } from '@/services/webAgent'

const STORAGE_KEY = 'geovela.web.agent-config.v1'
const defaults: WebAgentConfig = { transport: 'proxy', proxyUrl: 'https://geovela-agent.2273764807.workers.dev', endpoint: 'https://api.openai.com/v1', model: '', apiKey: '' }

function saved(): WebAgentConfig {
  try { return { ...defaults, ...JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}'), apiKey: '' } } catch { return defaults }
}

interface ConfigState {
  config: WebAgentConfig
  connected: boolean
  update: (patch: Partial<WebAgentConfig>) => void
  setConnected: (value: boolean) => void
}

export const useWebAgentConfigStore = create<ConfigState>((set, get) => ({
  config: saved(), connected: false,
  update: (patch) => {
    const config = { ...get().config, ...patch }
    set({ config, connected: false })
    const { apiKey: _apiKey, ...safe } = config
    localStorage.setItem(STORAGE_KEY, JSON.stringify(safe))
  },
  setConnected: (connected) => set({ connected }),
}))
