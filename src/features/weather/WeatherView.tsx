import { FormEvent, useEffect, useMemo, useRef, useState } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { Bot, CheckCircle2, Loader2, Send, Settings2, Sparkles, Unplug, Wrench, X } from 'lucide-react'
import { useMapStore } from '@/stores/mapStore'
import { resolveWeatherIntent, testWebAgentConnection, type WebAgentConfig } from '@/services/webAgent'
import { executeToolEvents, type AgentToolEvent, type WeatherMetric } from '@/services/toolEventRouter'

interface ForecastDay {
  date: string
  weatherCode: number
  maxTemperatureC: number
  minTemperatureC: number
  precipitationMm: number
  precipitationProbabilityPercent: number
  maxWindSpeedKmh: number
}
interface CityWeather { name: string; region: string; latitude: number; longitude: number; forecast: ForecastDay[] }
interface WeatherSample { generatedAt: string; timezone: string; cities: CityWeather[] }
interface ModelPredictionDay { date: string; horizonDays: number; openMeteoMaxC: number; modelMaxC: number; correctionC: number }
interface ModelCity {
  name: string
  predictions: ModelPredictionDay[]
  validation: Array<{ horizonDays: number; correctionEnabled: boolean; rawMaeC: number; modelMaeC: number }>
}
interface ModelOutput {
  generatedAt: string
  trainingPeriod: { start: string; end: string }
  method: string
  validation: { rawMaeC: number; modelMaeC: number; improvementPercent: number; beatsRawForecast: boolean }
  cities: ModelCity[]
}
type MetricKey = WeatherMetric

interface AgentMessage {
  id: number
  role: 'user' | 'assistant'
  text: string
  tools?: string[]
  chartCity?: string
  modelChart?: boolean
}

const SOURCE_ID = 'geovela-weather-cities'
const POINT_ID = 'geovela-weather-points'
const LABEL_ID = 'geovela-weather-labels'
const METRICS: Record<MetricKey, { label: string; unit: string; digits: number; stops: Array<number | string> }> = {
  maxTemperatureC: { label: '最高气温', unit: '°C', digits: 0, stops: [-20, '#3569b0', 0, '#75b7dd', 15, '#f5be55', 30, '#df543c', 40, '#9c2242'] },
  precipitationMm: { label: '降雨量', unit: 'mm', digits: 1, stops: [0, '#dbeafe', 2, '#7dd3fc', 10, '#3b82f6', 30, '#1e3a8a'] },
  precipitationProbabilityPercent: { label: '降雨概率', unit: '%', digits: 0, stops: [0, '#e2e8f0', 30, '#93c5fd', 60, '#3b82f6', 100, '#1e3a8a'] },
  maxWindSpeedKmh: { label: '最大风速', unit: 'km/h', digits: 0, stops: [0, '#dcfce7', 15, '#86efac', 30, '#22c55e', 60, '#166534'] },
}

function metricColor(metric: MetricKey): maplibregl.ExpressionSpecification {
  return ['interpolate', ['linear'], ['get', 'value'], ...METRICS[metric].stops] as maplibregl.ExpressionSpecification
}

function cityFeatures(cities: CityWeather[], day: number, selected: string, metric: MetricKey) {
  const config = METRICS[metric]
  return {
    type: 'FeatureCollection' as const,
    features: cities.map((city) => {
      const value = city.forecast[day][metric]
      return {
        type: 'Feature' as const,
        geometry: { type: 'Point' as const, coordinates: [city.longitude, city.latitude] },
        properties: { name: city.name, value, label: `${city.name} ${value.toFixed(config.digits)}${config.unit}`, selected: city.name === selected },
      }
    }),
  }
}

function weatherDescription(code: number) {
  if (code === 0) return '晴'
  if (code <= 3) return '多云'
  if (code <= 48) return '雾'
  if (code <= 57) return '毛毛雨'
  if (code <= 67) return '雨'
  if (code <= 77) return '雪'
  if (code <= 82) return '阵雨'
  if (code <= 86) return '阵雪'
  return '雷雨'
}

function TemperatureChart({ city }: { city: CityWeather }) {
  const values = city.forecast.flatMap((day) => [day.maxTemperatureC, day.minTemperatureC])
  const low = Math.floor(Math.min(...values) - 2)
  const high = Math.ceil(Math.max(...values) + 2)
  const y = (value: number) => 116 - ((value - low) / (high - low || 1)) * 84
  const x = (index: number) => 48 + index * 108
  const line = (key: 'maxTemperatureC' | 'minTemperatureC') => city.forecast.map((day, index) => `${x(index)},${y(day[key])}`).join(' ')
  return <section className="rounded-lg border border-border bg-bg-secondary p-3">
    <div className="flex items-center justify-between gap-2"><h3 className="text-sm font-semibold">温度趋势</h3><div className="flex gap-3 text-[10px] text-text-muted"><span className="text-orange-600">● 最高</span><span className="text-blue-500">● 最低</span></div></div>
    <svg className="mt-2 w-full" viewBox="0 0 300 155" role="img" aria-label={`${city.name}三天最高和最低气温折线图`}>
      {[0, 1, 2].map((index) => { const value = low + ((high - low) * index) / 2; return <g key={index}><line x1="38" x2="288" y1={y(value)} y2={y(value)} stroke="currentColor" opacity="0.12" /><text x="2" y={y(value) + 4} fontSize="9" fill="currentColor" opacity="0.6">{Math.round(value)}°</text></g> })}
      <polyline points={line('maxTemperatureC')} fill="none" stroke="#e86f2e" strokeWidth="3" />
      <polyline points={line('minTemperatureC')} fill="none" stroke="#3b82f6" strokeWidth="3" />
      {city.forecast.map((day, index) => <g key={day.date}>
        <circle cx={x(index)} cy={y(day.maxTemperatureC)} r="4" fill="#e86f2e" /><circle cx={x(index)} cy={y(day.minTemperatureC)} r="4" fill="#3b82f6" />
        <text x={x(index)} y={y(day.maxTemperatureC) - 8} textAnchor="middle" fontSize="10" fill="currentColor">{day.maxTemperatureC}°</text>
        <text x={x(index)} y={y(day.minTemperatureC) + 14} textAnchor="middle" fontSize="10" fill="currentColor">{day.minTemperatureC}°</text>
        <text x={x(index)} y="146" textAnchor="middle" fontSize="10" fill="currentColor">{day.date.slice(5)}</text>
      </g>)}
    </svg>
  </section>
}

function RainBarChart({ city }: { city: CityWeather }) {
  const maximum = Math.max(1, ...city.forecast.map((day) => day.precipitationMm))
  return <section className="rounded-lg border border-border bg-bg-secondary p-3">
    <h3 className="text-sm font-semibold">每日降雨量</h3>
    <svg className="mt-2 w-full" viewBox="0 0 300 145" role="img" aria-label={`${city.name}三天降雨量柱形图`}>
      <line x1="35" x2="290" y1="112" y2="112" stroke="currentColor" opacity="0.25" />
      {city.forecast.map((day, index) => { const height = (day.precipitationMm / maximum) * 78; const x = 52 + index * 86; return <g key={day.date}>
        <rect x={x} y={112 - height} width="42" height={height} rx="4" fill="#3b82f6" />
        <text x={x + 21} y={Math.max(14, 106 - height)} textAnchor="middle" fontSize="10" fill="currentColor">{day.precipitationMm.toFixed(1)} mm</text>
        <text x={x + 21} y="130" textAnchor="middle" fontSize="10" fill="currentColor">{day.date.slice(5)}</text><text x={x + 21} y="142" textAnchor="middle" fontSize="9" fill="currentColor" opacity="0.65">概率 {day.precipitationProbabilityPercent}%</text>
      </g> })}
    </svg>
  </section>
}

function RainShareChart({ city }: { city: CityWeather }) {
  const values = city.forecast.map((day) => day.precipitationMm)
  const total = values.reduce((sum, value) => sum + value, 0)
  const colors = ['#7dd3fc', '#3b82f6', '#1e3a8a']
  let offset = 0
  return <section className="rounded-lg border border-border bg-bg-secondary p-3"><h3 className="text-sm font-semibold">三天降雨占比</h3><div className="mt-3 flex items-center gap-4">
    <svg viewBox="0 0 42 42" className="h-24 w-24 shrink-0 -rotate-90" role="img" aria-label={`${city.name}三天降雨量占比环形图`}>
      <circle cx="21" cy="21" r="15.9" fill="none" stroke="#e2e8f0" strokeWidth="7" />
      {total > 0 && values.map((value, index) => { const share = value / total * 100; const element = <circle key={index} cx="21" cy="21" r="15.9" fill="none" stroke={colors[index]} strokeWidth="7" strokeDasharray={`${share} ${100 - share}`} strokeDashoffset={-offset} />; offset += share; return element })}
    </svg>
    <div className="min-w-0 flex-1 space-y-1 text-xs">{city.forecast.map((day, index) => <div key={day.date} className="flex justify-between gap-2"><span><span style={{ color: colors[index] }}>●</span> {day.date.slice(5)}</span><span>{total > 0 ? `${Math.round(day.precipitationMm / total * 100)}%` : '无降雨'}</span></div>)}<div className="border-t border-border pt-1 text-text-muted">合计 {total.toFixed(1)} mm</div></div>
  </div></section>
}

function ModelComparisonChart({ city }: { city: ModelCity }) {
  const values = city.predictions.flatMap((day) => [day.openMeteoMaxC, day.modelMaxC])
  const low = Math.floor(Math.min(...values) - 2)
  const high = Math.ceil(Math.max(...values) + 2)
  const y = (value: number) => 112 - ((value - low) / (high - low || 1)) * 80
  const x = (index: number) => 48 + index * 108
  const points = (key: 'openMeteoMaxC' | 'modelMaxC') => city.predictions.map((day, index) => `${x(index)},${y(day[key])}`).join(' ')
  return <section className="rounded-lg border border-border bg-bg-secondary p-3">
    <div className="flex items-center justify-between gap-2"><h3 className="text-sm font-semibold">模型与原始预报</h3><div className="flex gap-2 text-[10px]"><span className="text-slate-500">● 原始</span><span className="text-purple-600">● GeoVela</span></div></div>
    <svg className="mt-2 w-full" viewBox="0 0 300 150" role="img" aria-label={`${city.name}模型与原始最高气温预报对比图`}>
      <polyline points={points('openMeteoMaxC')} fill="none" stroke="#64748b" strokeWidth="3" strokeDasharray="5 4" />
      <polyline points={points('modelMaxC')} fill="none" stroke="#9333ea" strokeWidth="3" />
      {city.predictions.map((day, index) => <g key={day.date}>
        <circle cx={x(index)} cy={y(day.openMeteoMaxC)} r="4" fill="#64748b" /><circle cx={x(index)} cy={y(day.modelMaxC)} r="4" fill="#9333ea" />
        <text x={x(index)} y={y(day.modelMaxC) - 9} textAnchor="middle" fontSize="10" fill="currentColor">{day.modelMaxC}°</text>
        <text x={x(index)} y="136" textAnchor="middle" fontSize="10" fill="currentColor">{day.date.slice(5)}</text>
        <text x={x(index)} y="148" textAnchor="middle" fontSize="9" fill="currentColor" opacity="0.65">修正 {day.correctionC > 0 ? '+' : ''}{day.correctionC}°</text>
      </g>)}
    </svg>
  </section>
}

const QUICK_PROMPTS = ['查看全国未来三天天气', '定位到无锡市', '预测无锡市未来三天天气', '绘制无锡市温度趋势图']

function AgentPanel({ sample, model, onSelectCity, onSetMetric, map }: {
  sample: WeatherSample
  model: ModelOutput | null
  onSelectCity: (name: string) => void
  onSetMetric: (metric: MetricKey) => void
  map: { current: maplibregl.Map | null }
}) {
  const [input, setInput] = useState('')
  const [running, setRunning] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [config, setConfig] = useState<WebAgentConfig | null>(null)
  const [draft, setDraft] = useState<WebAgentConfig>({ transport: 'direct', proxyUrl: '', endpoint: 'https://api.openai.com/v1', model: '', apiKey: '' })
  const [connectionState, setConnectionState] = useState<'idle' | 'testing' | 'success' | 'error'>('idle')
  const [connectionError, setConnectionError] = useState('')
  const [messages, setMessages] = useState<AgentMessage[]>([{ id: 1, role: 'assistant', text: '你好，我是 GeoVela Agent。我可以查询全国天气、定位城市、展示预测并绘制温度趋势图。' }])
  const nextId = useRef(2)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' }) }, [messages, running])

  const run = async (raw: string) => {
    const text = raw.trim()
    if (!text || running) return
    setInput('')
    setMessages((items) => [...items, { id: nextId.current++, role: 'user', text }])
    setRunning(true)
    await new Promise((resolve) => window.setTimeout(resolve, 420))
    let intent = null
    if (config) {
      try {
        intent = await resolveWeatherIntent(config, text)
      } catch (cause) {
        setMessages((items) => [...items, { id: nextId.current++, role: 'assistant', text: `模型 API 调用失败：${cause instanceof Error ? cause.message : '未知错误'}。请检查端点、模型、Key 和 CORS 设置，或断开 API 使用内置模式。` }])
        setRunning(false)
        return
      }
    }
    const cityName = intent?.city?.replace(/市$/, '')
    const city = sample.cities.find((item) => cityName ? item.name === cityName : text.includes(item.name))
    const nationwide = intent ? intent.scope === 'nationwide' : /(全国|各城市|代表城市)/.test(text)
    const locate = intent ? intent.action === 'locate' : /(定位|飞到|缩放到|查找)/.test(text)
    const chart = intent ? intent.action === 'chart' : /(图表|趋势|折线|绘制)/.test(text)
    const prediction = intent ? intent.action === 'predict' : /(预测|预报|未来)/.test(text)
    const rain = intent ? intent.metric === 'rain' : /(降雨|下雨|降水)/.test(text)
    const wind = intent ? intent.metric === 'wind' : /(风速|大风)/.test(text)
    let reply: AgentMessage
    if (nationwide) {
      const values = sample.cities.flatMap((item) => item.forecast.map((day) => day.maxTemperatureC))
      const hottest = sample.cities.reduce((best, item) => item.forecast[0].maxTemperatureC > best.forecast[0].maxTemperatureC ? item : best)
      const average = values.reduce((sum, value) => sum + value, 0) / values.length
      const events: AgentToolEvent[] = [
        { type: 'tool_call', tool: 'weather.set_metric', arguments: { metric: rain ? 'precipitationMm' : wind ? 'maxWindSpeedKmh' : 'maxTemperatureC' } },
        { type: 'tool_call', tool: 'map.fit_bounds', arguments: { bounds: [[73, 18], [135, 54]], padding: 38, duration: 800 } },
      ]
      const outcome = executeToolEvents(events, { map: map.current, selectCity: onSelectCity, setMetric: onSetMetric })
      reply = { id: nextId.current++, role: 'assistant', tools: [...(config ? ['ai.route_intent'] : []), 'weather.get_forecast', ...outcome.tools], text: `已将 ${sample.cities.length} 个代表城市的未来三天${rain ? '降雨量' : wind ? '最大风速' : '最高气温'}渲染到地图。三天城市最高气温均值约 ${average.toFixed(1)}°C；首日最高为${hottest.name} ${hottest.forecast[0].maxTemperatureC}°C。` }
    } else if (city) {
      const modelCity = model?.cities.find((item) => item.name === city.name)
      const events: AgentToolEvent[] = [
        { type: 'tool_call', tool: 'weather.select_city', arguments: { city: city.name } },
        { type: 'tool_call', tool: 'map.fly_to', arguments: { center: [city.longitude, city.latitude], zoom: locate ? 8.5 : 6.5, duration: 900 } },
      ]
      if (chart) {
        events.push({ type: 'tool_call', tool: 'chart.render', arguments: { city: city.name, chart: 'temperature' } })
        const outcome = executeToolEvents(events, { map: map.current, selectCity: onSelectCity, setMetric: onSetMetric })
        reply = { id: nextId.current++, role: 'assistant', tools: [...(config ? ['ai.route_intent'] : []), 'weather.get_forecast', ...outcome.tools], chartCity: outcome.chartCity, modelChart: outcome.modelChart, text: `已定位${city.name}，并根据三天预报生成最高、最低气温趋势图。` }
      } else if (prediction && modelCity) {
        const summary = modelCity.predictions.map((day) => `${day.date.slice(5)} ${day.modelMaxC}°C`).join('，')
        events.push({ type: 'tool_call', tool: 'chart.render', arguments: { city: city.name, chart: 'model-comparison' } })
        const outcome = executeToolEvents(events, { map: map.current, selectCity: onSelectCity, setMetric: onSetMetric })
        reply = { id: nextId.current++, role: 'assistant', tools: [...(config ? ['ai.route_intent'] : []), 'weather.predict_temperature', ...outcome.tools], modelChart: outcome.modelChart, chartCity: outcome.chartCity, text: `${city.name}未来三天 GeoVela 最高气温预测：${summary}。图中同时展示 Open-Meteo 原始预报供对比。` }
      } else {
        const today = city.forecast[0]
        const outcome = executeToolEvents(events, { map: map.current, selectCity: onSelectCity, setMetric: onSetMetric })
        reply = { id: nextId.current++, role: 'assistant', tools: [...(config ? ['ai.route_intent'] : []), ...outcome.tools], text: `已定位到${city.name}。${today.date.slice(5)} 预计${weatherDescription(today.weatherCode)}，${today.minTemperatureC}–${today.maxTemperatureC}°C，降雨概率 ${today.precipitationProbabilityPercent}%。` }
      }
    } else {
      reply = { id: nextId.current++, role: 'assistant', tools: config ? ['ai.route_intent'] : undefined, text: cityName ? `当前数据集中没有“${cityName}”，请选择已加载的城市。` : '我目前可执行全国三天天气、代表城市定位、三天预测和温度趋势图。请尝试“预测无锡市未来三天天气”。' }
    }
    setMessages((items) => [...items, reply])
    setRunning(false)
  }

  const submit = (event: FormEvent) => { event.preventDefault(); void run(input) }
  const connect = async () => {
    if (!draft.endpoint.trim() || !draft.model.trim()) return
    setConnectionState('testing'); setConnectionError('')
    try {
      await testWebAgentConnection(draft)
      setConfig({ ...draft }); setConnectionState('success')
    } catch (cause) {
      setConnectionState('error'); setConnectionError(cause instanceof Error ? cause.message : '连接失败')
    }
  }
  const disconnect = () => { setConfig(null); setDraft((value) => ({ ...value, apiKey: '' })); setConnectionState('idle') }
  return <section className="flex min-h-[430px] flex-col rounded-xl border border-border bg-bg-secondary shadow-sm">
    <div className="flex items-center gap-2 border-b border-border px-3 py-3"><span className="rounded-lg bg-accent-primary p-2 text-white"><Bot className="h-4 w-4" /></span><div><h3 className="text-sm font-semibold">GeoVela Agent</h3><p className="text-[10px] text-text-muted">{config ? `${config.model} · API 模式` : '内置模式 · 4 个 GIS 工具组'}</p></div><span className="ml-auto flex items-center gap-1 text-[10px] text-emerald-600"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />就绪</span><button type="button" onClick={() => setShowSettings((value) => !value)} className="rounded p-1.5 text-text-muted hover:bg-bg-hover" aria-label="Agent API 设置">{showSettings ? <X className="h-4 w-4" /> : <Settings2 className="h-4 w-4" />}</button></div>
    {showSettings && <div className="space-y-2 border-b border-border bg-bg-primary p-3 text-xs">
      <div className="flex items-center justify-between"><strong>连接 OpenAI 兼容 API</strong>{config && <button type="button" onClick={disconnect} className="inline-flex items-center gap-1 text-red-600"><Unplug className="h-3 w-3" />断开</button>}</div>
      <div className="grid grid-cols-2 gap-1 rounded bg-bg-secondary p-1" role="group" aria-label="API 连接方式"><button type="button" onClick={() => setDraft({ ...draft, transport: 'direct' })} className={`rounded px-2 py-1.5 ${draft.transport === 'direct' ? 'bg-accent-primary text-white' : 'text-text-muted'}`}>浏览器直连</button><button type="button" onClick={() => setDraft({ ...draft, transport: 'proxy' })} className={`rounded px-2 py-1.5 ${draft.transport === 'proxy' ? 'bg-accent-primary text-white' : 'text-text-muted'}`}>安全代理</button></div>
      {draft.transport === 'proxy' && <label className="block text-text-muted">GeoVela Agent Server<input value={draft.proxyUrl} onChange={(event) => setDraft({ ...draft, proxyUrl: event.target.value })} placeholder="https://your-geovela-agent.example.com" className="mt-1 w-full rounded border border-border bg-bg-secondary px-2 py-1.5 text-text-primary" /></label>}
      <label className="block text-text-muted">API 端点<input value={draft.endpoint} onChange={(event) => setDraft({ ...draft, endpoint: event.target.value })} placeholder="https://api.openai.com/v1" className="mt-1 w-full rounded border border-border bg-bg-secondary px-2 py-1.5 text-text-primary" /></label>
      <label className="block text-text-muted">模型<input value={draft.model} onChange={(event) => setDraft({ ...draft, model: event.target.value })} placeholder="输入你的模型 ID" className="mt-1 w-full rounded border border-border bg-bg-secondary px-2 py-1.5 text-text-primary" /></label>
      <label className="block text-text-muted">API Key（只保存在当前页面内存）<input type="password" value={draft.apiKey} onChange={(event) => setDraft({ ...draft, apiKey: event.target.value })} autoComplete="off" placeholder="sk-..." className="mt-1 w-full rounded border border-border bg-bg-secondary px-2 py-1.5 text-text-primary" /></label>
      <p className="rounded bg-amber-50 p-2 text-[10px] text-amber-800">{draft.transport === 'direct' ? 'Key 会从浏览器直接发送到 API 端点，端点必须允许 CORS。' : 'Key 会通过你填写的 GeoVela Agent Server 转发，服务端不保存 Key，并会执行限流和目标地址检查。'} Key 不会写入 localStorage，刷新即清除。</p>
      <button type="button" onClick={() => void connect()} disabled={!draft.endpoint.trim() || !draft.model.trim() || (draft.transport === 'proxy' && !draft.proxyUrl.trim()) || connectionState === 'testing'} className="flex w-full items-center justify-center gap-1 rounded bg-accent-primary px-3 py-2 text-white disabled:opacity-50">{connectionState === 'testing' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : connectionState === 'success' ? <CheckCircle2 className="h-3.5 w-3.5" /> : null}{connectionState === 'testing' ? '正在测试…' : connectionState === 'success' ? '已连接，重新测试' : '测试并连接'}</button>
      {connectionState === 'error' && <p role="alert" className="text-[10px] text-red-600">连接失败：{connectionError}</p>}
    </div>}
    <div ref={scrollRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
      {messages.map((message) => <div key={message.id} className={message.role === 'user' ? 'ml-8' : 'mr-2'}><div className={`rounded-xl px-3 py-2 text-xs leading-5 ${message.role === 'user' ? 'bg-accent-primary text-white' : 'border border-border bg-bg-primary'}`}>{message.text}</div>{message.tools && <div className="mt-1.5 flex flex-wrap gap-1">{message.tools.map((tool) => <span key={tool} className="inline-flex items-center gap-1 rounded bg-bg-hover px-1.5 py-1 text-[9px] text-text-muted"><Wrench className="h-2.5 w-2.5" />{tool}</span>)}</div>}{message.chartCity && (() => { const chartCity = sample.cities.find((item) => item.name === message.chartCity); const modelCity = model?.cities.find((item) => item.name === message.chartCity); if (message.modelChart && modelCity) return <div className="mt-2"><ModelComparisonChart city={modelCity} /></div>; return chartCity ? <div className="mt-2"><TemperatureChart city={chartCity} /></div> : null })()}</div>)}
      {running && <div className="mr-16 flex items-center gap-2 rounded-xl border border-border bg-bg-primary px-3 py-2 text-xs text-text-muted"><Loader2 className="h-3.5 w-3.5 animate-spin" />Agent 正在调用工具…</div>}
    </div>
    <div className="border-t border-border p-3"><div className="mb-2 flex gap-1 overflow-x-auto pb-1">{QUICK_PROMPTS.map((prompt) => <button key={prompt} type="button" onClick={() => void run(prompt)} disabled={running} className="shrink-0 rounded-full border border-border bg-bg-primary px-2 py-1 text-[10px] text-text-secondary hover:border-accent-primary hover:text-accent-primary disabled:opacity-50">{prompt}</button>)}</div><form onSubmit={submit} className="flex items-end gap-2"><label className="sr-only" htmlFor="agent-input">向 GeoVela Agent 提问</label><textarea id="agent-input" value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void run(input) } }} placeholder="试试：定位到无锡市" rows={2} className="min-h-[42px] flex-1 resize-none rounded-lg border border-border bg-bg-primary px-3 py-2 text-xs outline-none focus:border-accent-primary" /><button type="submit" disabled={!input.trim() || running} className="rounded-lg bg-accent-primary p-2.5 text-white hover:opacity-90 disabled:opacity-40" aria-label="发送"><Send className="h-4 w-4" /></button></form><p className="mt-2 flex items-center gap-1 text-[9px] text-text-muted"><Sparkles className="h-3 w-3" />{config ? '模型负责理解意图，地图和数据操作仍由受控工具执行。' : '当前使用内置意图识别；点击齿轮可接入模型 API。'}</p></div>
  </section>
}

export function WeatherView() {
  const [sample, setSample] = useState<WeatherSample | null>(null)
  const [model, setModel] = useState<ModelOutput | null>(null)
  const [modelError, setModelError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [dayIndex, setDayIndex] = useState(0)
  const [selectedName, setSelectedName] = useState('无锡')
  const [metric, setMetric] = useState<MetricKey>('maxTemperatureC')
  const mapContainer = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const currentSelection = useRef({ dayIndex, selectedName, metric })
  currentSelection.current = { dayIndex, selectedName, metric }
  const basemap = useMapStore((state) => state.basemap)

  useEffect(() => {
    const controller = new AbortController()
    fetch(`${import.meta.env.BASE_URL}data/weather/forecast-sample.json`, { signal: controller.signal })
      .then((response) => { if (!response.ok) throw new Error(`HTTP ${response.status}`); return response.json() as Promise<WeatherSample> })
      .then((data) => {
        const keys: MetricKey[] = ['maxTemperatureC', 'precipitationMm', 'precipitationProbabilityPercent', 'maxWindSpeedKmh']
        if (!Array.isArray(data.cities) || data.cities.length === 0 || data.cities.some((city) => city.forecast.length !== 3 || city.forecast.some((day) => keys.some((key) => !Number.isFinite(day[key])) || !Number.isFinite(day.minTemperatureC)))) throw new Error('天气样本格式不正确')
        setSample(data)
      })
      .catch((cause: unknown) => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : '加载失败') })
    fetch(`${import.meta.env.BASE_URL}data/weather/model-predictions.json`, { signal: controller.signal })
      .then((response) => { if (!response.ok) throw new Error(`HTTP ${response.status}`); return response.json() as Promise<ModelOutput> })
      .then(setModel)
      .catch((cause: unknown) => { if (!controller.signal.aborted) setModelError(cause instanceof Error ? cause.message : '模型结果加载失败') })
    return () => controller.abort()
  }, [])

  const selectedCity = useMemo(() => sample?.cities.find((city) => city.name === selectedName) ?? sample?.cities[0], [sample, selectedName])
  const selectedModelCity = useMemo(() => model?.cities.find((city) => city.name === selectedName), [model, selectedName])

  useEffect(() => {
    if (!sample || !mapContainer.current) return
    const style: maplibregl.StyleSpecification | string = basemap.type === 'vector-style' ? basemap.url : { version: 8, sources: { weatherBasemap: { type: 'raster', tiles: [basemap.url], tileSize: 256, attribution: basemap.attribution } }, layers: [{ id: 'weatherBasemap', type: 'raster', source: 'weatherBasemap' }] }
    const map = new maplibregl.Map({ container: mapContainer.current, style, center: [104, 35], zoom: 3 })
    mapRef.current = map
    map.addControl(new maplibregl.NavigationControl(), 'top-right')
    const onLoad = () => {
      const current = currentSelection.current
      map.addSource(SOURCE_ID, { type: 'geojson', data: cityFeatures(sample.cities, current.dayIndex, current.selectedName, current.metric) })
      map.addLayer({ id: POINT_ID, type: 'circle', source: SOURCE_ID, paint: { 'circle-radius': ['case', ['get', 'selected'], 10, 7], 'circle-color': metricColor(current.metric), 'circle-stroke-color': '#fff', 'circle-stroke-width': 2 } })
      map.addLayer({ id: LABEL_ID, type: 'symbol', source: SOURCE_ID, layout: { 'text-field': ['get', 'label'], 'text-size': 12, 'text-offset': [0, 1.35], 'text-anchor': 'top', 'text-allow-overlap': false }, paint: { 'text-color': '#263849', 'text-halo-color': '#fff', 'text-halo-width': 2 } })
      map.fitBounds([[73, 18], [135, 54]], { padding: 32, duration: 0 })
    }
    const onCityClick = (event: maplibregl.MapLayerMouseEvent) => { const name = event.features?.[0]?.properties?.name; if (typeof name === 'string') setSelectedName(name) }
    map.on('load', onLoad); map.on('click', POINT_ID, onCityClick); map.on('click', LABEL_ID, onCityClick)
    return () => { map.remove(); mapRef.current = null }
  }, [sample, basemap])

  useEffect(() => {
    const map = mapRef.current
    const source = map?.getSource(SOURCE_ID) as maplibregl.GeoJSONSource | undefined
    if (sample && source) { source.setData(cityFeatures(sample.cities, dayIndex, selectedName, metric)); map?.setPaintProperty(POINT_ID, 'circle-color', metricColor(metric)) }
  }, [sample, dayIndex, selectedName, metric])

  const dates = sample?.cities[0]?.forecast.map((day) => day.date) ?? []
  const selectedDay = selectedCity?.forecast[dayIndex]
  return <div className="flex h-full min-h-0 flex-col md:flex-row">
    <div className="min-h-[260px] flex-1 md:min-h-0" ref={mapContainer} aria-label="全国代表城市天气地图" />
    <aside className="w-full shrink-0 overflow-y-auto border-t border-border bg-bg-primary p-4 md:w-[420px] md:border-l md:border-t-0">
      <h2 className="text-lg font-semibold">全国天气</h2><p className="mt-1 text-xs text-text-muted">{sample?.cities.length ?? 32} 个城市 · 温度、降雨与风速</p>
      {error && <p role="alert" className="mt-4 text-sm text-red-600">天气数据加载失败：{error}</p>}{!sample && !error && <p className="mt-4 text-sm">正在加载天气样本…</p>}
      {sample && <>
        <div className="mt-4"><AgentPanel sample={sample} model={model} onSelectCity={setSelectedName} onSetMetric={setMetric} map={mapRef} /></div>
        <div className="mt-4 grid grid-cols-2 gap-1" role="group" aria-label="选择地图天气指标">{(Object.keys(METRICS) as MetricKey[]).map((key) => <button key={key} type="button" onClick={() => setMetric(key)} aria-pressed={metric === key} className={`rounded px-2 py-2 text-xs ${metric === key ? 'bg-accent-primary text-white' : 'bg-bg-secondary text-text-secondary hover:bg-bg-hover'}`}>{METRICS[key].label}</button>)}</div>
        <div className="mt-2 flex gap-1" role="group" aria-label="选择预报日期">{dates.map((date, index) => <button key={date} type="button" onClick={() => setDayIndex(index)} aria-pressed={dayIndex === index} className={`flex-1 rounded px-2 py-2 text-xs ${dayIndex === index ? 'bg-accent-primary text-white' : 'bg-bg-secondary text-text-secondary hover:bg-bg-hover'}`}>{date.slice(5)}</button>)}</div>
        {model && <div className={`mt-3 rounded-lg border p-3 text-xs ${model.validation.beatsRawForecast ? 'border-green-300 bg-green-50 text-green-900' : 'border-amber-300 bg-amber-50 text-amber-900'}`}>
          <div className="font-semibold">GeoVela 实验模型回测</div>
          <div className="mt-1">原始 MAE {model.validation.rawMaeC}°C → 模型 MAE {model.validation.modelMaeC}°C（{model.validation.improvementPercent > 0 ? '改善' : '变化'} {model.validation.improvementPercent}%）</div>
          {!model.validation.beatsRawForecast && <div className="mt-1">当前模型未超过原始预报，仅作为训练与比较实验。</div>}
          <div className="mt-1 opacity-75">训练期：{model.trainingPeriod.start} 至 {model.trainingPeriod.end}</div>
        </div>}
        {modelError && <p className="mt-3 text-xs text-amber-700">模型结果暂不可用：{modelError}</p>}
        {selectedCity && selectedDay && <><div className="mt-3 rounded-lg border border-border bg-bg-secondary p-3"><div className="flex items-baseline justify-between"><h3 className="font-semibold">{selectedCity.name}</h3><span className="text-sm">{weatherDescription(selectedDay.weatherCode)}</span></div><div className="mt-2 grid grid-cols-4 gap-2 text-center">
          <div><div className="text-base font-semibold">{selectedDay.maxTemperatureC}°</div><div className="text-[10px] text-text-muted">最高</div></div><div><div className="text-base font-semibold">{selectedDay.precipitationMm}</div><div className="text-[10px] text-text-muted">降雨 mm</div></div><div><div className="text-base font-semibold">{selectedDay.precipitationProbabilityPercent}%</div><div className="text-[10px] text-text-muted">降雨概率</div></div><div><div className="text-base font-semibold">{selectedDay.maxWindSpeedKmh}</div><div className="text-[10px] text-text-muted">风速 km/h</div></div>
        </div></div><div className="mt-3 space-y-3">{selectedModelCity && <ModelComparisonChart city={selectedModelCity} />}<TemperatureChart city={selectedCity} /><RainBarChart city={selectedCity} /><RainShareChart city={selectedCity} /></div></>}
        <p className="mt-4 text-xs text-text-muted">点击地图城市查看图表。样本生成：{new Date(sample.generatedAt).toLocaleString('zh-CN', { timeZone: sample.timezone })}，不会自动更新。</p><p className="mt-2 text-xs text-text-muted">数据：<a href="https://open-meteo.com/" target="_blank" rel="noreferrer" className="underline">Open-Meteo</a>（CC BY 4.0）。城市点位不代表全国连续天气分布。</p>
      </>}
    </aside>
  </div>
}
