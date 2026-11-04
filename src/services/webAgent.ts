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

export interface WeatherAgentStreamEvent {
  event: 'tool_call' | 'tool_result' | 'assistant_message'
  data: Record<string, unknown>
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

function parseSseBlock(block: string): WeatherAgentStreamEvent | null {
  const lines = block.split(/\r?\n/)
  const event = lines.find((line) => line.startsWith('event:'))?.slice(6).trim()
  const data = lines.filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trim()).join('\n')
  if (!event || !data || !['tool_call', 'tool_result', 'assistant_message'].includes(event)) return null
  return { event: event as WeatherAgentStreamEvent['event'], data: JSON.parse(data) as Record<string, unknown> }
}

async function readSsePlan(response: Response, onEvent?: (event: WeatherAgentStreamEvent) => void): Promise<WeatherAgentPlan> {
  let intent: WeatherAgentIntent | null = null
  const toolEvents: unknown[] = []
  const consume = (block: string) => {
    const event = parseSseBlock(block)
    if (!event) return
    onEvent?.(event)
    if (event.event === 'tool_call' && event.data.tool !== 'ai.route_intent') toolEvents.push(event.data)
    if (event.event === 'tool_result' && event.data.tool === 'ai.route_intent') intent = parseIntent(JSON.stringify(event.data.result))
  }
  if (!response.body) {
    for (const block of (await response.text()).split(/\r?\n\r?\n/)) consume(block)
  } else {
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    while (true) {
      const { done, value } = await reader.read()
      buffer += decoder.decode(value, { stream: !done })
      const blocks = buffer.split(/\r?\n\r?\n/)
      buffer = blocks.pop() ?? ''
      blocks.forEach(consume)
      if (done) break
    }
    if (buffer.trim()) consume(buffer)
  }
  if (!intent) throw new Error('Agent Server 未返回有效意图结果')
  return { intent, toolEvents }
}

export async function resolveWeatherAgentPlan(config: WebAgentConfig, message: string, signal?: AbortSignal, onEvent?: (event: WeatherAgentStreamEvent) => void): Promise<WeatherAgentPlan> {
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
  return readSsePlan(response, onEvent)
}

export async function testWebAgentConnection(config: WebAgentConfig): Promise<void> {
  await resolveWeatherIntent(config, '定位到无锡市')
}
