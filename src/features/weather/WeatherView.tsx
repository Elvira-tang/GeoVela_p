import { useEffect, useMemo, useRef, useState } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { useMapStore } from '@/stores/mapStore'

interface ForecastDay { date: string; maxTemperatureC: number }
interface CityWeather {
  name: string
  region: string
  latitude: number
  longitude: number
  forecast: ForecastDay[]
}
interface WeatherSample {
  generatedAt: string
  timezone: string
  cities: CityWeather[]
}

const SOURCE_ID = 'geovela-weather-cities'
const POINT_ID = 'geovela-weather-points'
const LABEL_ID = 'geovela-weather-labels'

function cityFeatures(cities: CityWeather[], day: number, selected: string) {
  return {
    type: 'FeatureCollection' as const,
    features: cities.map((city) => ({
      type: 'Feature' as const,
      geometry: { type: 'Point' as const, coordinates: [city.longitude, city.latitude] },
      properties: {
        name: city.name,
        temperature: city.forecast[day].maxTemperatureC,
        label: `${city.name} ${Math.round(city.forecast[day].maxTemperatureC)}°`,
        selected: city.name === selected,
      },
    })),
  }
}

function TemperatureChart({ city }: { city: CityWeather }) {
  const values = city.forecast.map((day) => day.maxTemperatureC)
  const low = Math.floor(Math.min(...values) - 2)
  const high = Math.ceil(Math.max(...values) + 2)
  const y = (value: number) => 120 - ((value - low) / (high - low || 1)) * 92
  const points = values.map((value, index) => `${42 + index * 108},${y(value)}`).join(' ')

  return (
    <div className="rounded-lg border border-border bg-bg-secondary p-4">
      <h3 className="font-semibold">{city.name} · 未来三天最高气温</h3>
      <p className="mt-1 text-xs text-text-muted">原始天气预报，尚非 GeoVela 自训练模型的结果</p>
      <svg className="mt-3 w-full" viewBox="0 0 300 172" role="img" aria-label={`${city.name}未来三天最高气温折线图`}>
        {[0, 1, 2].map((index) => {
          const value = low + ((high - low) * index) / 2
          return <g key={index}>
            <line x1="34" x2="288" y1={y(value)} y2={y(value)} stroke="currentColor" opacity="0.15" />
            <text x="3" y={y(value) + 4} fontSize="10" fill="currentColor" opacity="0.65">{Math.round(value)}°</text>
          </g>
        })}
        <polyline points={points} fill="none" stroke="#e86f2e" strokeWidth="3" strokeLinejoin="round" />
        {city.forecast.map((day, index) => <g key={day.date}>
          <circle cx={42 + index * 108} cy={y(day.maxTemperatureC)} r="5" fill="#e86f2e" />
          <text x={42 + index * 108} y={y(day.maxTemperatureC) - 10} textAnchor="middle" fontSize="12" fill="currentColor">{day.maxTemperatureC}°C</text>
          <text x={42 + index * 108} y="153" textAnchor="middle" fontSize="11" fill="currentColor">{day.date.slice(5)}</text>
        </g>)}
      </svg>
    </div>
  )
}

export function WeatherView() {
  const [sample, setSample] = useState<WeatherSample | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [dayIndex, setDayIndex] = useState(0)
  const [selectedName, setSelectedName] = useState('北京')
  const mapContainer = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const currentSelection = useRef({ dayIndex, selectedName })
  currentSelection.current = { dayIndex, selectedName }
  const basemap = useMapStore((state) => state.basemap)

  useEffect(() => {
    const controller = new AbortController()
    fetch(`${import.meta.env.BASE_URL}data/weather/forecast-sample.json`, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        return response.json() as Promise<WeatherSample>
      })
      .then((data) => {
        if (!Array.isArray(data.cities) || data.cities.length === 0 ||
          data.cities.some((city) => city.forecast.length !== 3 || city.forecast.some((day) => !Number.isFinite(day.maxTemperatureC)))) {
          throw new Error('天气样本格式不正确')
        }
        setSample(data)
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : '加载失败')
      })
    return () => controller.abort()
  }, [])

  const selectedCity = useMemo(
    () => sample?.cities.find((city) => city.name === selectedName) ?? sample?.cities[0],
    [sample, selectedName],
  )

  useEffect(() => {
    if (!sample || !mapContainer.current) return
    const style: maplibregl.StyleSpecification | string = basemap.type === 'vector-style'
      ? basemap.url
      : {
        version: 8,
        sources: { weatherBasemap: { type: 'raster', tiles: [basemap.url], tileSize: 256, attribution: basemap.attribution } },
        layers: [{ id: 'weatherBasemap', type: 'raster', source: 'weatherBasemap' }],
      }
    const map = new maplibregl.Map({ container: mapContainer.current, style, center: [104, 35], zoom: 3 })
    mapRef.current = map
    map.addControl(new maplibregl.NavigationControl(), 'top-right')
    const onLoad = () => {
      map.addSource(SOURCE_ID, {
        type: 'geojson',
        data: cityFeatures(sample.cities, currentSelection.current.dayIndex, currentSelection.current.selectedName),
      })
      map.addLayer({
        id: POINT_ID, type: 'circle', source: SOURCE_ID,
        paint: {
          'circle-radius': ['case', ['get', 'selected'], 10, 7],
          'circle-color': ['interpolate', ['linear'], ['get', 'temperature'], -20, '#3569b0', 0, '#75b7dd', 15, '#f5be55', 30, '#df543c', 40, '#9c2242'],
          'circle-stroke-color': '#fff', 'circle-stroke-width': 2,
        },
      })
      map.addLayer({
        id: LABEL_ID, type: 'symbol', source: SOURCE_ID,
        layout: {
          'text-field': ['get', 'label'], 'text-size': 12,
          'text-offset': [0, 1.35], 'text-anchor': 'top',
          'text-allow-overlap': false,
        },
        paint: { 'text-color': '#263849', 'text-halo-color': '#fff', 'text-halo-width': 2 },
      })
      map.fitBounds([[73, 18], [135, 54]], { padding: 32, duration: 0 })
    }
    const onCityClick = (event: maplibregl.MapLayerMouseEvent) => {
      const name = event.features?.[0]?.properties?.name
      if (typeof name === 'string') setSelectedName(name)
    }
    map.on('load', onLoad)
    map.on('click', POINT_ID, onCityClick)
    map.on('click', LABEL_ID, onCityClick)
    return () => { map.remove(); mapRef.current = null }
    // The sample and basemap are fixed for this view's lifetime.
  }, [sample, basemap])

  useEffect(() => {
    const map = mapRef.current
    const source = map?.getSource(SOURCE_ID) as maplibregl.GeoJSONSource | undefined
    if (sample && source) source.setData(cityFeatures(sample.cities, dayIndex, selectedName))
  }, [sample, dayIndex, selectedName])

  const dates = sample?.cities[0]?.forecast.map((day) => day.date) ?? []

  return <div className="flex h-full min-h-0 flex-col md:flex-row">
    <div className="min-h-[260px] flex-1 md:min-h-0" ref={mapContainer} aria-label="全国代表城市天气地图" />
    <aside className="w-full shrink-0 overflow-y-auto border-t border-border bg-bg-primary p-4 md:w-80 md:border-l md:border-t-0">
      <h2 className="text-lg font-semibold">全国天气</h2>
      <p className="mt-1 text-xs text-text-muted">31 个代表城市 · 每日最高气温</p>
      {error && <p role="alert" className="mt-4 text-sm text-red-600">天气数据加载失败：{error}</p>}
      {!sample && !error && <p className="mt-4 text-sm">正在加载天气样本…</p>}
      {sample && <>
        <div className="mt-4 flex gap-1" role="group" aria-label="选择预报日期">
          {dates.map((date, index) => <button key={date} type="button" onClick={() => setDayIndex(index)}
            aria-pressed={dayIndex === index}
            className={`flex-1 rounded px-2 py-2 text-xs ${dayIndex === index ? 'bg-accent-primary text-white' : 'bg-bg-secondary text-text-secondary hover:bg-bg-hover'}`}>
            {date.slice(5)}
          </button>)}
        </div>
        <p className="mt-3 text-xs text-text-muted">点击地图上的城市点或名称查看三天曲线。</p>
        {selectedCity && <div className="mt-4"><TemperatureChart city={selectedCity} /></div>}
        <p className="mt-4 text-xs text-text-muted">样本生成：{new Date(sample.generatedAt).toLocaleString('zh-CN', { timeZone: sample.timezone })}。这是一份固定样本，日期过后不会自动更新。</p>
        <p className="mt-2 text-xs text-text-muted">数据：<a href="https://open-meteo.com/" target="_blank" rel="noreferrer" className="underline">Open-Meteo</a>（CC BY 4.0）。城市点位不代表全国连续天气分布。</p>
      </>}
    </aside>
  </div>
}
