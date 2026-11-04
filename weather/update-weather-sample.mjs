import { mkdir, writeFile } from 'node:fs/promises'

// One representative city per mainland provincial-level administrative area.
// Coordinates are approximate city centres in WGS84.
const cities = [
  ['北京', '北京', 39.9042, 116.4074], ['天津', '天津', 39.0842, 117.2009],
  ['石家庄', '河北', 38.0428, 114.5149], ['太原', '山西', 37.8706, 112.5489],
  ['呼和浩特', '内蒙古', 40.8426, 111.7492], ['沈阳', '辽宁', 41.8057, 123.4315],
  ['长春', '吉林', 43.8171, 125.3235], ['哈尔滨', '黑龙江', 45.8038, 126.5350],
  ['上海', '上海', 31.2304, 121.4737], ['南京', '江苏', 32.0603, 118.7969],
  ['杭州', '浙江', 30.2741, 120.1551], ['合肥', '安徽', 31.8206, 117.2272],
  ['福州', '福建', 26.0745, 119.2965], ['南昌', '江西', 28.6820, 115.8579],
  ['济南', '山东', 36.6512, 117.1201], ['郑州', '河南', 34.7466, 113.6254],
  ['武汉', '湖北', 30.5928, 114.3055], ['长沙', '湖南', 28.2282, 112.9388],
  ['广州', '广东', 23.1291, 113.2644], ['南宁', '广西', 22.8170, 108.3669],
  ['海口', '海南', 20.0440, 110.1983], ['重庆', '重庆', 29.5630, 106.5516],
  ['成都', '四川', 30.5728, 104.0668], ['贵阳', '贵州', 26.6470, 106.6302],
  ['昆明', '云南', 25.0389, 102.7183], ['拉萨', '西藏', 29.6525, 91.1721],
  ['西安', '陕西', 34.3416, 108.9398], ['兰州', '甘肃', 36.0611, 103.8343],
  ['西宁', '青海', 36.6171, 101.7782], ['银川', '宁夏', 38.4872, 106.2309],
  ['乌鲁木齐', '新疆', 43.8256, 87.6168],
]

const params = new URLSearchParams({
  latitude: cities.map((city) => city[2]).join(','),
  longitude: cities.map((city) => city[3]).join(','),
  daily: [
    'weather_code',
    'temperature_2m_max',
    'temperature_2m_min',
    'precipitation_sum',
    'precipitation_probability_max',
    'wind_speed_10m_max',
  ].join(','),
  forecast_days: '3',
  timezone: 'Asia/Shanghai',
})
const response = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`)
if (!response.ok) throw new Error(`Open-Meteo HTTP ${response.status}`)
const forecasts = await response.json()
if (!Array.isArray(forecasts) || forecasts.length !== cities.length) {
  throw new Error(`Expected ${cities.length} city forecasts`)
}

const output = {
  generatedAt: new Date().toISOString(),
  source: 'Open-Meteo Forecast API (CC BY 4.0)',
  sourceUrl: 'https://open-meteo.com/en/docs',
  timezone: 'Asia/Shanghai',
  metrics: [
    'weather code',
    'daily maximum and minimum temperature',
    'daily precipitation sum and maximum probability',
    'daily maximum wind speed',
  ],
  coverage: '31 representative mainland cities; not a nationwide weather grid',
  cities: cities.map(([name, region, latitude, longitude], index) => {
    const daily = forecasts[index].daily
    const required = [
      daily?.weather_code,
      daily?.temperature_2m_max,
      daily?.temperature_2m_min,
      daily?.precipitation_sum,
      daily?.precipitation_probability_max,
      daily?.wind_speed_10m_max,
    ]
    if (daily?.time?.length !== 3 || required.some((values) => values?.length !== 3)) {
      throw new Error(`Incomplete forecast for ${name}`)
    }
    return {
      name, region, latitude, longitude,
      forecast: daily.time.map((date, day) => ({
        date,
        weatherCode: daily.weather_code[day],
        maxTemperatureC: daily.temperature_2m_max[day],
        minTemperatureC: daily.temperature_2m_min[day],
        precipitationMm: daily.precipitation_sum[day],
        precipitationProbabilityPercent: daily.precipitation_probability_max[day],
        maxWindSpeedKmh: daily.wind_speed_10m_max[day],
      })),
    }
  }),
}

await mkdir(new URL('../public/data/weather/', import.meta.url), { recursive: true })
await writeFile(new URL('../public/data/weather/forecast-sample.json', import.meta.url), `${JSON.stringify(output, null, 2)}\n`)
console.log(`Saved ${output.cities.length} cities for ${output.cities[0].forecast.map((day) => day.date).join(', ')}`)
