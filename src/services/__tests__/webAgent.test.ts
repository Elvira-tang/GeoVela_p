import { describe, expect, it } from 'vitest'
import { resolveWeatherIntent } from '../webAgent'

describe('web weather agent provider', () => {
  it('normalizes an OpenAI-compatible response', async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = async (input, init) => {
      expect(String(input)).toBe('https://example.com/v1/chat/completions')
      expect(init?.headers).toMatchObject({ Authorization: 'Bearer test-key' })
      return new Response(JSON.stringify({ choices: [{ message: { content: '```json\n{"scope":"city","city":"无锡","action":"predict","metric":"temperature"}\n```' } }] }))
    }
    try {
      await expect(resolveWeatherIntent({ transport: 'direct', proxyUrl: '', endpoint: 'https://example.com/v1/', model: 'test', apiKey: 'test-key' }, '预测无锡')).resolves.toEqual({ scope: 'city', city: '无锡', action: 'predict', metric: 'temperature' })
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('routes credentials through the configured proxy', async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = async (input, init) => {
      expect(String(input)).toBe('https://agent.example.com/v1/intent')
      expect(JSON.parse(String(init?.body))).toMatchObject({ endpoint: 'https://provider.example/v1', api_key: 'secret', message: '定位无锡' })
      return new Response(JSON.stringify({ scope: 'city', city: '无锡', action: 'locate', metric: 'temperature' }))
    }
    try {
      await expect(resolveWeatherIntent({ transport: 'proxy', proxyUrl: 'https://agent.example.com/', endpoint: 'https://provider.example/v1', model: 'test', apiKey: 'secret' }, '定位无锡')).resolves.toMatchObject({ action: 'locate', city: '无锡' })
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
