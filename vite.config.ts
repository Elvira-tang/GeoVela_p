import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig, type ProxyOptions } from 'vite'

const proxyTargets: Record<string, string> = {
  openai: 'https://api.openai.com',
  anthropic: 'https://api.anthropic.com',
  deepseek: 'https://api.deepseek.com',
  minimax: 'https://api.minimax.chat',
  moonshot: 'https://api.moonshot.cn',
  qwen: 'https://dashscope.aliyuncs.com',
  doubao: 'https://ark.cn-beijing.volces.com',
  zhipu: 'https://open.bigmodel.cn',
  gemini: 'https://generativelanguage.googleapis.com',
  groq: 'https://api.groq.com',
  mistral: 'https://api.mistral.ai',
  xai: 'https://api.x.ai',
  openrouter: 'https://openrouter.ai',
}

const proxy = Object.fromEntries(
  Object.entries(proxyTargets).map(([name, target]) => {
    const prefix = `/proxy/${name}`
    return [
      prefix,
      {
        target,
        changeOrigin: true,
        rewrite: (path) => path.replace(new RegExp(`^${prefix}`), ''),
      } satisfies ProxyOptions,
    ]
  }),
)

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  build: mode === 'web' ? {
    rollupOptions: {
      input: { index: resolve(__dirname, 'web.html') },
    },
  } : undefined,
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  optimizeDeps: {
    entries: ['index.html', 'loading.html'],
  },
  server: {
    fs: {
      deny: ['local', '.git', 'python-backend'],
    },
    proxy,
  },
}))
