import { useEffect, useMemo, useRef, useState } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { useMapStore } from '@/stores/mapStore'

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
type MetricKey = 'maxTemperatureC' | 'precipitationMm' | 'precipitationProbabilityPercent' | 'maxWindSpeedKmh'

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

export function WeatherView() {
  const [sample, setSample] = useState<WeatherSample | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [dayIndex, setDayIndex] = useState(0)
  const [selectedName, setSelectedName] = useState('北京')
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
    return () => controller.abort()
  }, [])

  const selectedCity = useMemo(() => sample?.cities.find((city) => city.name === selectedName) ?? sample?.cities[0], [sample, selectedName])

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
      <h2 className="text-lg font-semibold">全国天气</h2><p className="mt-1 text-xs text-text-muted">31 个代表城市 · 温度、降雨与风速</p>
      {error && <p role="alert" className="mt-4 text-sm text-red-600">天气数据加载失败：{error}</p>}{!sample && !error && <p className="mt-4 text-sm">正在加载天气样本…</p>}
      {sample && <>
        <div className="mt-4 grid grid-cols-2 gap-1" role="group" aria-label="选择地图天气指标">{(Object.keys(METRICS) as MetricKey[]).map((key) => <button key={key} type="button" onClick={() => setMetric(key)} aria-pressed={metric === key} className={`rounded px-2 py-2 text-xs ${metric === key ? 'bg-accent-primary text-white' : 'bg-bg-secondary text-text-secondary hover:bg-bg-hover'}`}>{METRICS[key].label}</button>)}</div>
        <div className="mt-2 flex gap-1" role="group" aria-label="选择预报日期">{dates.map((date, index) => <button key={date} type="button" onClick={() => setDayIndex(index)} aria-pressed={dayIndex === index} className={`flex-1 rounded px-2 py-2 text-xs ${dayIndex === index ? 'bg-accent-primary text-white' : 'bg-bg-secondary text-text-secondary hover:bg-bg-hover'}`}>{date.slice(5)}</button>)}</div>
        {selectedCity && selectedDay && <><div className="mt-3 rounded-lg border border-border bg-bg-secondary p-3"><div className="flex items-baseline justify-between"><h3 className="font-semibold">{selectedCity.name}</h3><span className="text-sm">{weatherDescription(selectedDay.weatherCode)}</span></div><div className="mt-2 grid grid-cols-4 gap-2 text-center">
          <div><div className="text-base font-semibold">{selectedDay.maxTemperatureC}°</div><div className="text-[10px] text-text-muted">最高</div></div><div><div className="text-base font-semibold">{selectedDay.precipitationMm}</div><div className="text-[10px] text-text-muted">降雨 mm</div></div><div><div className="text-base font-semibold">{selectedDay.precipitationProbabilityPercent}%</div><div className="text-[10px] text-text-muted">降雨概率</div></div><div><div className="text-base font-semibold">{selectedDay.maxWindSpeedKmh}</div><div className="text-[10px] text-text-muted">风速 km/h</div></div>
        </div></div><div className="mt-3 space-y-3"><TemperatureChart city={selectedCity} /><RainBarChart city={selectedCity} /><RainShareChart city={selectedCity} /></div></>}
        <p className="mt-4 text-xs text-text-muted">点击地图城市查看图表。样本生成：{new Date(sample.generatedAt).toLocaleString('zh-CN', { timeZone: sample.timezone })}，不会自动更新。</p><p className="mt-2 text-xs text-text-muted">数据：<a href="https://open-meteo.com/" target="_blank" rel="noreferrer" className="underline">Open-Meteo</a>（CC BY 4.0）。城市点位不代表全国连续天气分布。</p>
      </>}
    </aside>
  </div>
}
