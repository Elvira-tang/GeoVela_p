import { afterEach, describe, expect, it, vi } from 'vitest'
import { handleRequest } from './index'

const origin = 'https://elvira-tang.github.io'

afterEach(() => vi.unstubAllGlobals())

describe('GeoVela Cloudflare Worker', () => {
  it('serves health and CORS headers', async () => {
    const response = await handleRequest(new Request('https://worker.example/health', { headers: { Origin: origin } }), {})
    expect(response.status).toBe(200)
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(origin)
    await expect(response.json()).resolves.toMatchObject({ status: 'ok' })
  })

  it('rejects private and insecure provider endpoints', async () => {
    const response = await handleRequest(new Request('https://worker.example/v1/intent', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ endpoint: 'http://127.0.0.1:8000/v1', model: 'test', message: '定位无锡' }) }), {})
    expect(response.status).toBe(400)
  })

  it('forwards to an OpenAI-compatible provider and validates the intent', async () => {
    const providerFetch = vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: '{"scope":"city","city":"无锡","action":"locate","metric":"temperature"}' } }] }), { status: 200 }))
    vi.stubGlobal('fetch', providerFetch)
    const response = await handleRequest(new Request('https://worker.example/v1/intent', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', 'CF-Connecting-IP': '203.0.113.2' }, body: JSON.stringify({ endpoint: 'https://api.example.com/v1', model: 'test', api_key: 'secret', message: '定位无锡' }) }), {})
    expect(response.status).toBe(200)
    expect(providerFetch).toHaveBeenCalledOnce()
    const init = providerFetch.mock.calls[0][1]
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer secret')
    await expect(response.json()).resolves.toMatchObject({ city: '无锡', action: 'locate' })
  })
})
