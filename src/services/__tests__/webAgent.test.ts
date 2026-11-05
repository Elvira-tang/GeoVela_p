import { describe, expect, it } from 'vitest'
import { resolveWeatherAgentPlan, resolveWeatherIntent, runWebAgentLoop } from '../webAgent'

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

  it('parses a proxy SSE run into an intent and executable tool events', async () => {
    const originalFetch = globalThis.fetch
    const observed: string[] = []
    globalThis.fetch = async (input) => {
      expect(String(input)).toBe('https://agent.example.com/v1/run')
      const chunks = [
        'event: tool_call\ndata: {"run_id":"run-1","sequence":1,"emitted_at":"2026-11-05T00:00:00Z","payload":{"type":"tool_call","tool":"ai.route_intent","arguments":{}}}\n',
        'event: tool_result\ndata: {"run_id":"run-1","sequence":2,"emitted_at":"2026-11-05T00:00:01Z","duration_ms":42,"payload":{"type":"tool_result","tool":"ai.route_intent","result":{"scope":"city","city":"无锡","action":"locate","metric":"temperature"}}}\n',
        'event: tool_call\ndata: {"run_id":"run-1","sequence":3,"emitted_at":"2026-11-05T00:00:02Z","payload":{"type":"tool_call","tool":"weather.select_city","arguments":{"city":"无锡"}}}\n',
        'event: tool_call\ndata: {"run_id":"run-1","sequence":4,"emitted_at":"2026-11-05T00:00:03Z","payload":{"type":"tool_call","tool":"map.fly_to","arguments":{"city":"无锡","zoom":8.5,"duration":900}}}\n',
        'event: assistant_message\ndata: {"run_id":"run-1","sequence":5,"emitted_at":"2026-11-05T00:00:04Z","payload":{"type":"assistant_message","text":"工具计划已生成"}}\n',
      ].map((chunk) => new TextEncoder().encode(`${chunk}\n`))
      return new Response(new ReadableStream({ start(controller) { chunks.forEach((chunk) => controller.enqueue(chunk)); controller.close() } }), { headers: { 'Content-Type': 'text/event-stream' } })
    }
    try {
      await expect(resolveWeatherAgentPlan({ transport: 'proxy', proxyUrl: 'https://agent.example.com', endpoint: 'https://provider.example/v1', model: 'test', apiKey: 'secret' }, '定位无锡', undefined, (event) => observed.push(`${event.event}:${String(event.data.tool ?? '')}`))).resolves.toMatchObject({
        intent: { city: '无锡', action: 'locate' },
        toolEvents: [
          { tool: 'weather.select_city' },
          { tool: 'map.fly_to' },
        ],
        runId: 'run-1',
      })
      expect(observed).toEqual(['tool_call:ai.route_intent', 'tool_result:ai.route_intent', 'tool_call:weather.select_city', 'tool_call:map.fly_to', 'assistant_message:'])
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('returns tool results to the proxy and continues until a final answer', async () => {
    const originalFetch = globalThis.fetch
    const requests: Array<Record<string, unknown>> = []
    let turn = 0
    globalThis.fetch = async (_input, init) => {
      requests.push(JSON.parse(String(init?.body)))
      turn += 1
      const data = turn === 1
        ? { events: [
            { event: 'tool_call', data: { run_id: 'run-loop', sequence: 1, emitted_at: '2026-11-05T00:00:00Z', payload: { type: 'tool_call', id: 'call-1', tool: 'weather.get_forecast', arguments: { city: '无锡', days: 3 } } } },
            { event: 'turn_state', data: { run_id: 'run-loop', sequence: 2, emitted_at: '2026-11-05T00:00:01Z', payload: { message: { role: 'assistant', content: null, tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'weather.get_forecast', arguments: '{"city":"无锡","days":3}' } }] } } } },
          ] }
        : { events: [
            { event: 'assistant_message', data: { run_id: 'run-loop', sequence: 4, emitted_at: '2026-11-05T00:00:02Z', payload: { type: 'assistant_message', text: '无锡未来三天天气已查询。' } } },
            { event: 'turn_state', data: { run_id: 'run-loop', sequence: 5, emitted_at: '2026-11-05T00:00:03Z', payload: { message: { role: 'assistant', content: '无锡未来三天天气已查询。' } } } },
          ] }
      return Response.json(data)
    }
    try {
      const execute = async (calls: Array<{ id: string; tool: string }>) => calls.map((call) => ({ type: 'tool_result' as const, id: call.id, tool: call.tool, result: { ok: true } }))
      await expect(runWebAgentLoop({ transport: 'proxy', proxyUrl: 'https://agent.example.com', endpoint: 'https://provider.example/v1', model: 'test', apiKey: 'secret' }, '无锡天气', execute)).resolves.toEqual({ text: '无锡未来三天天气已查询。', runId: 'run-loop', turns: 2 })
      expect(requests[1]).toMatchObject({ run_id: 'run-loop', sequence: 3 })
      expect(requests[1].messages).toEqual(expect.arrayContaining([expect.objectContaining({ role: 'tool', tool_call_id: 'call-1' })]))
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
