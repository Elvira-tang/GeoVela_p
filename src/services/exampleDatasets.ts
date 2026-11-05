import { getDefaultStyle, type GeoJSONFeatureCollection, type MapLayerDefinition } from '@/services/geo'
import { parseGeoJSON } from '@/services/geo/parsers/geojsonParser'
import { fetchFiveDayWeather } from '@/services/weatherApi'

function layerFromGeoJSON(id: string, name: string, geojson: GeoJSONFeatureCollection, source: string): MapLayerDefinition {
  const data = parseGeoJSON(JSON.stringify(geojson), `${name}.geojson`)
  return { id, name, sourceType: 'geojson', visible: true, style: getDefaultStyle(data.geometryType), data, meta: { fileName: `${name}.geojson`, extension: '.geojson', sourceType: 'geojson', fileSize: JSON.stringify(geojson).length, mimeType: 'application/geo+json' }, addedAt: Date.now(), extension: source }
}

export async function loadWeatherExample(signal?: AbortSignal): Promise<MapLayerDefinition> {
  const response = await fetch(`${import.meta.env.BASE_URL}data/weather/forecast-sample.json`, { signal })
  if (!response.ok) throw new Error(`天气城市清单 HTTP ${response.status}`)
  const fallback = await response.json() as { cities: Array<{ name: string; region: string; latitude: number; longitude: number }> }
  const live = await fetchFiveDayWeather(fallback.cities, signal)
  const geojson: GeoJSONFeatureCollection = { type: 'FeatureCollection', features: live.cities.map((city, index) => ({ type: 'Feature', id: index, geometry: { type: 'Point', coordinates: [city.longitude, city.latitude] }, properties: { name: city.name, region: city.region, source: 'Open-Meteo', recent_5d: JSON.stringify(city.recent), forecast_5d: JSON.stringify(city.forecast), today_max_c: city.forecast[0]?.maxTemperatureC, today_min_c: city.forecast[0]?.minTemperatureC, precipitation_mm: city.forecast[0]?.precipitationMm, wind_kmh: city.forecast[0]?.maxWindSpeedKmh } })) }
  const layer = layerFromGeoJSON('example-weather-cities', '全国城市天气', geojson, 'weather-example')
  layer.style = { ...layer.style, renderType: 'graduated', graduated: { field: 'today_max_c', method: 'equal-interval', classes: 5 } }
  return layer
}

export async function loadMilkTeaExample(proxyUrl: string, bbox: [number, number, number, number], signal?: AbortSignal): Promise<MapLayerDefinition> {
  const response = await fetch(`${proxyUrl.replace(/\/$/, '')}/v1/poi/milk-tea?bbox=${encodeURIComponent(bbox.join(','))}`, { signal })
  if (!response.ok) throw new Error(`POI 服务 HTTP ${response.status}`)
  const geojson = await response.json() as GeoJSONFeatureCollection
  if (!geojson.features.length) throw new Error('当前地图范围没有找到奶茶店，请放大到城市范围后重试')
  return layerFromGeoJSON('example-milk-tea-poi', '奶茶店 POI', geojson, 'poi-example')
}
