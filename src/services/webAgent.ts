export interface WebAgentConfig {
  transport: 'direct' | 'proxy'
  language?: 'zh' | 'en'
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
  runId?: string
}

export interface WeatherAgentStreamEvent {
  event: 'tool_call' | 'tool_result' | 'assistant_message' | 'turn_state'
  data: Record<string, unknown>
  runId: string
  sequence: number
  emittedAt: string
  durationMs?: number
}

export interface AgentToolCall {
  type: 'tool_call'
  id: string
  tool: string
  arguments: Record<string, unknown>
}

export interface AgentToolResult {
  type: 'tool_result'
  id: string
  tool: string
  result: Record<string, unknown>
}

interface ProviderMessage {
  role: 'user' | 'assistant' | 'tool'
  content: string | null
  tool_call_id?: string
  tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>
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
  if (!event || !data || !['tool_call', 'tool_result', 'assistant_message', 'turn_state'].includes(event)) return null
  const envelope = JSON.parse(data) as Record<string, unknown>
  if (typeof envelope.run_id !== 'string' || !Number.isInteger(envelope.sequence) || typeof envelope.emitted_at !== 'string' || typeof envelope.payload !== 'object' || envelope.payload === null) {
    throw new Error('Agent Server 返回了无效的事件信封')
  }
  return {
    event: event as WeatherAgentStreamEvent['event'],
    data: envelope.payload as Record<string, unknown>,
    runId: envelope.run_id,
    sequence: envelope.sequence as number,
    emittedAt: envelope.emitted_at,
    durationMs: typeof envelope.duration_ms === 'number' ? envelope.duration_ms : undefined,
  }
}

export async function runWebAgentLoop(
  config: WebAgentConfig,
  message: string,
  execute: (calls: AgentToolCall[]) => Promise<AgentToolResult[]> | AgentToolResult[],
  signal?: AbortSignal,
  onEvent?: (event: WeatherAgentStreamEvent) => void,
): Promise<{ text: string; runId: string; turns: number }> {
  if (config.transport !== 'proxy') throw new Error('完整 Agent Loop 需要安全代理模式')
  const messages: ProviderMessage[] = [{ role: 'user', content: message }]
  let runId: string | undefined
  let sequence = 0
  for (let turn = 1; turn <= 8; turn += 1) {
    const response = await fetch(`${config.proxyUrl.trim().replace(/\/$/, '')}/v1/agent/turn?format=json`, {
      method: 'POST', signal, headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ endpoint: config.endpoint, model: config.model, api_key: config.apiKey || null, message: message.slice(0, 40_000), messages, run_id: runId, sequence }),
    })
    if (!response.ok) {
      const body = await response.json().catch(() => ({})) as { detail?: string }
      throw new Error(`Agent Server ${response.status}${body.detail ? `: ${body.detail}` : ''}`)
    }
    const calls: AgentToolCall[] = []
    let state: ProviderMessage | undefined
    let finalText: string | undefined
    const batch = await response.json() as { events?: Array<{ event?: string; data?: Record<string, unknown> }> }
    const consume = (block: string) => {
      const event = parseSseBlock(block)
      if (!event) return
      runId = event.runId; sequence = event.sequence; onEvent?.(event)
      if (event.event === 'tool_call') calls.push(event.data as unknown as AgentToolCall)
      if (event.event === 'assistant_message') finalText = String(event.data.text ?? '')
      if (event.event === 'turn_state') state = event.data.message as ProviderMessage
    }
    for (const item of batch.events ?? []) {
      consume(`event: ${String(item.event ?? '')}\ndata: ${JSON.stringify(item.data ?? {})}`)
    }
    if (!runId || !state) throw new Error('Agent Server 未返回有效 turn_state')
    messages.push(state)
    if (finalText !== undefined && calls.length === 0) return { text: finalText, runId, turns: turn }
    if (calls.length === 0) throw new Error('Agent 未返回工具调用或最终回答')
    const results = await execute(calls)
    if (results.length !== calls.length) throw new Error('工具结果数量与调用数量不一致')
    for (const result of results) {
      const event: WeatherAgentStreamEvent = { event: 'tool_result', data: result as unknown as Record<string, unknown>, runId, sequence: ++sequence, emittedAt: new Date().toISOString() }
      onEvent?.(event)
      messages.push({ role: 'tool', tool_call_id: result.id, content: JSON.stringify(result.result) })
    }
  }
  throw new Error('Agent 超过最大工具轮次（8）')
}

async function readSsePlan(response: Response, onEvent?: (event: WeatherAgentStreamEvent) => void): Promise<WeatherAgentPlan> {
  let intent: WeatherAgentIntent | null = null
  let runId: string | undefined
  let lastSequence = 0
  const toolEvents: unknown[] = []
  const consume = (block: string) => {
    const event = parseSseBlock(block)
    if (!event) return
    if (runId && event.runId !== runId) throw new Error('Agent Server 在一次响应中返回了多个 run_id')
    if (event.sequence <= lastSequence) throw new Error('Agent Server 事件序号无效')
    runId = event.runId
    lastSequence = event.sequence
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
  return { intent, toolEvents, runId }
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
