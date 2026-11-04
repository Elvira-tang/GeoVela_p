export interface WebAgentConfig {
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

export async function testWebAgentConnection(config: WebAgentConfig): Promise<void> {
  await resolveWeatherIntent(config, '定位到无锡市')
}
