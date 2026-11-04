export interface Env {
  ALLOWED_ORIGINS?: string
}

interface IntentRequest {
  endpoint: string
  model: string
  api_key?: string | null
  message: string
}

const SYSTEM_PROMPT = `You route Chinese user requests for a weather GIS web app.
Return exactly one JSON object and no markdown:
{"scope":"nationwide|city","city":"Chinese city name without 市 suffix","action":"weather|locate|predict|chart","metric":"temperature|rain|wind"}
Rules: locate means moving the map; predict means a future forecast/model request; chart means a chart/trend request; otherwise weather. Use nationwide when the request mentions China/nationwide/all cities.`

const DEFAULT_ORIGINS = ['https://elvira-tang.github.io', 'http://127.0.0.1:5173', 'http://127.0.0.1:5174']
const requestWindows = new Map<string, number[]>()

function json(value: unknown, status = 200, origin?: string) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }
  if (origin) {
    headers['Access-Control-Allow-Origin'] = origin
    headers.Vary = 'Origin'
  }
  return new Response(JSON.stringify(value), { status, headers })
}

function allowedOrigin(request: Request, env: Env) {
  const origin = request.headers.get('Origin') ?? ''
  const allowed = env.ALLOWED_ORIGINS?.split(',').map((item) => item.trim()).filter(Boolean) ?? DEFAULT_ORIGINS
  return allowed.includes(origin) ? origin : ''
}

function isUnsafeHostname(hostname: string) {
  const value = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (value === 'localhost' || value.endsWith('.localhost') || value.endsWith('.local')) return true
  const ipv4 = value.split('.').map(Number)
  if (ipv4.length === 4 && ipv4.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)) {
    return ipv4[0] === 10 || ipv4[0] === 127 || (ipv4[0] === 169 && ipv4[1] === 254) || (ipv4[0] === 172 && ipv4[1] >= 16 && ipv4[1] <= 31) || (ipv4[0] === 192 && ipv4[1] === 168) || ipv4[0] === 0
  }
  return value === '::1' || value.startsWith('fc') || value.startsWith('fd') || value.startsWith('fe8') || value.startsWith('fe9') || value.startsWith('fea') || value.startsWith('feb')
}

function providerUrl(endpoint: string) {
  const url = new URL(endpoint.trim())
  if (url.protocol !== 'https:' || isUnsafeHostname(url.hostname) || url.username || url.password) throw new Error('Provider endpoint must be a public HTTPS URL')
  url.pathname = url.pathname.replace(/\/$/, '')
  if (!url.pathname.endsWith('/chat/completions')) url.pathname += '/chat/completions'
  return url.toString()
}

function validatePayload(value: unknown): IntentRequest {
  if (!value || typeof value !== 'object') throw new Error('Invalid request body')
  const input = value as Partial<IntentRequest>
  if (typeof input.endpoint !== 'string' || input.endpoint.length > 500) throw new Error('Invalid endpoint')
  if (typeof input.model !== 'string' || !input.model.trim() || input.model.length > 200) throw new Error('Invalid model')
  if (typeof input.message !== 'string' || !input.message.trim() || input.message.length > 1000) throw new Error('Invalid message')
  if (input.api_key != null && typeof input.api_key !== 'string') throw new Error('Invalid API key')
  return input as IntentRequest
}

function validateIntent(value: unknown) {
  if (!value || typeof value !== 'object') throw new Error('Invalid model response')
  const intent = value as Record<string, unknown>
  if (!['nationwide', 'city'].includes(String(intent.scope))) throw new Error('Invalid scope')
  if (!['weather', 'locate', 'predict', 'chart'].includes(String(intent.action))) throw new Error('Invalid action')
  if (!['temperature', 'rain', 'wind'].includes(String(intent.metric))) throw new Error('Invalid metric')
  return intent
}

function rateLimited(request: Request) {
  const key = request.headers.get('CF-Connecting-IP') ?? 'unknown'
  const now = Date.now()
  const recent = (requestWindows.get(key) ?? []).filter((timestamp) => now - timestamp < 60_000)
  recent.push(now)
  requestWindows.set(key, recent)
  return recent.length > 20
}

export async function handleRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url)
  const origin = allowedOrigin(request, env)
  if (request.method === 'OPTIONS') {
    if (!origin) return json({ detail: 'Origin not allowed' }, 403)
    return new Response(null, { status: 204, headers: { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '86400', Vary: 'Origin' } })
  }
  if (url.pathname === '/health' && request.method === 'GET') return json({ status: 'ok', runtime: 'cloudflare-worker' }, 200, origin || undefined)
  if (url.pathname !== '/v1/intent' || request.method !== 'POST') return json({ detail: 'Not found' }, 404, origin || undefined)
  if (!origin) return json({ detail: 'Origin not allowed' }, 403)
  if (rateLimited(request)) return json({ detail: 'Too many requests' }, 429, origin)

  try {
    const payload = validatePayload(await request.json())
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (payload.api_key) headers.Authorization = `Bearer ${payload.api_key}`
    const upstream = await fetch(providerUrl(payload.endpoint), {
      method: 'POST',
      redirect: 'manual',
      headers,
      body: JSON.stringify({ model: payload.model, temperature: 0, messages: [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: payload.message }] }),
    })
    if (!upstream.ok) return json({ detail: `Provider returned HTTP ${upstream.status}` }, 502, origin)
    const body = await upstream.json() as { choices?: Array<{ message?: { content?: string } }> }
    const content = body.choices?.[0]?.message?.content ?? ''
    const start = content.indexOf('{'); const end = content.lastIndexOf('}')
    if (start < 0 || end < start) throw new Error('Missing JSON')
    return json(validateIntent(JSON.parse(content.slice(start, end + 1))), 200, origin)
  } catch (error) {
    const clientError = error instanceof Error && ['Invalid request body', 'Invalid endpoint', 'Invalid model', 'Invalid message', 'Invalid API key', 'Provider endpoint must be a public HTTPS URL'].includes(error.message)
    return json({ detail: clientError && error instanceof Error ? error.message : 'Provider response could not be processed' }, clientError ? 400 : 502, origin)
  }
}

export default { fetch: handleRequest }
