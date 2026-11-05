export interface WeatherCitySeed { name: string; region: string; latitude: number; longitude: number }

interface OpenMeteoDaily {
  time: string[]
  weather_code: number[]
  temperature_2m_max: number[]
  temperature_2m_min: number[]
  precipitation_sum: number[]
  precipitation_probability_max: number[]
  wind_speed_10m_max: number[]
}

interface OpenMeteoResult { latitude: number; longitude: number; timezone: string; daily: OpenMeteoDaily }

export async function fetchFiveDayWeather(cities: WeatherCitySeed[], signal?: AbortSignal) {
  const params = new URLSearchParams({
    latitude: cities.map((city) => city.latitude).join(','),
    longitude: cities.map((city) => city.longitude).join(','),
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,wind_speed_10m_max',
    past_days: '5',
    forecast_days: '5',
    timezone: 'Asia/Shanghai',
  })
  const response = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`, { signal })
  if (!response.ok) throw new Error(`Open-Meteo HTTP ${response.status}`)
  const raw = await response.json() as OpenMeteoResult | OpenMeteoResult[]
  const results = Array.isArray(raw) ? raw : [raw]
  if (results.length !== cities.length) throw new Error('Open-Meteo 返回城市数量不匹配')
  return {
    generatedAt: new Date().toISOString(),
    timezone: 'Asia/Shanghai',
    live: true,
    cities: results.map((item, cityIndex) => {
      const days = item.daily.time.map((date, index) => ({
        date,
        weatherCode: item.daily.weather_code[index],
        maxTemperatureC: item.daily.temperature_2m_max[index],
        minTemperatureC: item.daily.temperature_2m_min[index],
        precipitationMm: item.daily.precipitation_sum[index],
        precipitationProbabilityPercent: item.daily.precipitation_probability_max[index] ?? 0,
        maxWindSpeedKmh: item.daily.wind_speed_10m_max[index],
      }))
      return { ...cities[cityIndex], recent: days.slice(0, 5), forecast: days.slice(5, 10) }
    }),
  }
}
