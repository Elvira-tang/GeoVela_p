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
      await expect(resolveWeatherIntent({ endpoint: 'https://example.com/v1/', model: 'test', apiKey: 'test-key' }, '预测无锡')).resolves.toEqual({ scope: 'city', city: '无锡', action: 'predict', metric: 'temperature' })
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
