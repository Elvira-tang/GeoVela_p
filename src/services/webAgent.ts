export interface WebAgentConfig {
  transport: 'direct' | 'proxy'
  proxyUrl: string
  endpoint: string
  model: string
  apiKey: string
}

export interface WeatherAgentIntent {
  scope: 'nationwide' | 'city'
  city?: string
  action: 'weather' | 'locate' | 'predict' | 'chart'
  metric: 'temperature' | 'rain' | 'wind'
}

export interface WeatherAgentPlan {
  intent: WeatherAgentIntent
  toolEvents?: unknown[]
}

const SYSTEM_PROMPT = `You route Chinese user requests for a weather GIS web app.
Return exactly one JSON object and no markdown:
{"scope":"nationwide|city","city":"Chinese city name without 市 suffix","action":"weather|locate|predict|chart","metric":"temperature|rain|wind"}
Rules: locate means moving the map; predict means a future forecast/model request; chart means a chart/trend request; otherwise weather. Use nationwide when the request mentions China/nationwide/all cities.`

function completionUrl(endpoint: string) {
  const trimmed = endpoint.trim().replace(/\/$/, '')
  return trimmed.endsWith('/chat/completions') ? trimmed : `${trimmed}/chat/completions`
}

function parseIntent(content: string): WeatherAgentIntent {
  const match = content.match(/\{[\s\S]*\}/)
  if (!match) throw new Error('模型未返回可识别的 JSON')
  const value = JSON.parse(match[0]) as Partial<WeatherAgentIntent>
  if (!['nationwide', 'city'].includes(value.scope ?? '')) throw new Error('无效的 scope')
  if (!['weather', 'locate', 'predict', 'chart'].includes(value.action ?? '')) throw new Error('无效的 action')
  if (!['temperature', 'rain', 'wind'].includes(value.metric ?? '')) throw new Error('无效的 metric')
  return value as WeatherAgentIntent
}

export async function resolveWeatherIntent(config: WebAgentConfig, message: string, signal?: AbortSignal): Promise<WeatherAgentIntent> {
  if (config.transport === 'proxy') {
    const response = await fetch(`${config.proxyUrl.trim().replace(/\/$/, '')}/v1/intent`, {
      method: 'POST',
      signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint: config.endpoint, model: config.model, api_key: config.apiKey || null, message }),
    })
    if (!response.ok) {
      const body = await response.json().catch(() => ({})) as { detail?: string }
      throw new Error(`Agent Server ${response.status}${body.detail ? `: ${body.detail}` : ''}`)
    }
    return parseIntent(JSON.stringify(await response.json()))
  }
  const response = await fetch(completionUrl(config.endpoint), {
    method: 'POST',
    signal,
    headers: {
      'Content-Type': 'application/json',
      ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
    },
    body: JSON.stringify({
      model: config.model,
      temperature: 0,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: message },
      ],
    }),
  })
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 240)
    throw new Error(`API ${response.status}${detail ? `: ${detail}` : ''}`)
  }
  const body = await response.json() as { choices?: Array<{ message?: { content?: string } }> }
  const content = body.choices?.[0]?.message?.content
  if (!content) throw new Error('模型未返回消息内容')
  return parseIntent(content)
}

function parseSsePayload(text: string): WeatherAgentPlan {
  let intent: WeatherAgentIntent | null = null
  const toolEvents: unknown[] = []
  for (const block of text.split(/\r?\n\r?\n/)) {
    const event = block.split(/\r?\n/).find((line) => line.startsWith('event:'))?.slice(6).trim()
    const data = block.split(/\r?\n/).filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trim()).join('\n')
    if (!event || !data) continue
    const value = JSON.parse(data) as Record<string, unknown>
    if (event === 'tool_call' && value.tool !== 'ai.route_intent') toolEvents.push(value)
    if (event === 'tool_result' && value.tool === 'ai.route_intent') intent = parseIntent(JSON.stringify(value.result))
  }
  if (!intent) throw new Error('Agent Server 未返回有效意图结果')
  return { intent, toolEvents }
}

export async function resolveWeatherAgentPlan(config: WebAgentConfig, message: string, signal?: AbortSignal): Promise<WeatherAgentPlan> {
  if (config.transport !== 'proxy') return { intent: await resolveWeatherIntent(config, message, signal) }
  const response = await fetch(`${config.proxyUrl.trim().replace(/\/$/, '')}/v1/run`, {
    method: 'POST',
    signal,
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify({ endpoint: config.endpoint, model: config.model, api_key: config.apiKey || null, message }),
  })
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { detail?: string }
    throw new Error(`Agent Server ${response.status}${body.detail ? `: ${body.detail}` : ''}`)
  }
  return parseSsePayload(await response.text())
}

export async function testWebAgentConnection(config: WebAgentConfig): Promise<void> {
  await resolveWeatherIntent(config, '定位到无锡市')
}
