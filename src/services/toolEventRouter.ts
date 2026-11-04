import { z } from 'zod'

export const weatherMetricSchema = z.enum([
  'maxTemperatureC',
  'precipitationMm',
  'precipitationProbabilityPercent',
  'maxWindSpeedKmh',
])

const coordinateSchema = z.tuple([
  z.number().min(-180).max(180),
  z.number().min(-90).max(90),
])

const toolEventSchema = z.discriminatedUnion('tool', [
  z.object({
    type: z.literal('tool_call'),
    tool: z.literal('weather.set_metric'),
    arguments: z.object({ metric: weatherMetricSchema }).strict(),
  }).strict(),
  z.object({
    type: z.literal('tool_call'),
    tool: z.literal('weather.select_city'),
    arguments: z.object({ city: z.string().min(1).max(80) }).strict(),
  }).strict(),
  z.object({
    type: z.literal('tool_call'),
    tool: z.literal('map.fit_bounds'),
    arguments: z.object({
      bounds: z.tuple([coordinateSchema, coordinateSchema]),
      padding: z.number().int().min(0).max(200).default(38),
      duration: z.number().int().min(0).max(5000).default(800),
    }).strict(),
  }).strict(),
  z.object({
    type: z.literal('tool_call'),
    tool: z.literal('map.fly_to'),
    arguments: z.union([
      z.object({
        center: coordinateSchema,
        zoom: z.number().min(0).max(22),
        duration: z.number().int().min(0).max(5000).default(900),
      }).strict(),
      z.object({
        city: z.string().min(1).max(80),
        zoom: z.number().min(0).max(22),
        duration: z.number().int().min(0).max(5000).default(900),
      }).strict(),
    ]),
  }).strict(),
  z.object({
    type: z.literal('tool_call'),
    tool: z.literal('chart.render'),
    arguments: z.object({
      city: z.string().min(1).max(80),
      chart: z.enum(['temperature', 'model-comparison']),
    }).strict(),
  }).strict(),
])

export type WeatherMetric = z.infer<typeof weatherMetricSchema>
export type AgentToolEvent = z.infer<typeof toolEventSchema>

export interface ToolEventMap {
  fitBounds: (bounds: [[number, number], [number, number]], options: { padding: number; duration: number }) => void
  flyTo: (options: { center: [number, number]; zoom: number; duration: number }) => void
}

export interface ToolEventContext {
  map: ToolEventMap | null
  selectCity: (city: string) => void
  setMetric: (metric: WeatherMetric) => void
  resolveCity?: (city: string) => [number, number] | undefined
}

export interface ToolEventResult {
  tools: string[]
  chartCity?: string
  modelChart?: boolean
}

export function executeToolEvents(events: unknown, context: ToolEventContext): ToolEventResult {
  const parsed = z.array(toolEventSchema).max(12).parse(events)
  const result: ToolEventResult = { tools: [] }

  for (const event of parsed) {
    result.tools.push(event.tool)
    switch (event.tool) {
      case 'weather.set_metric':
        context.setMetric(event.arguments.metric)
        break
      case 'weather.select_city':
        context.selectCity(event.arguments.city)
        break
      case 'map.fit_bounds':
        context.map?.fitBounds(event.arguments.bounds, {
          padding: event.arguments.padding,
          duration: event.arguments.duration,
        })
        break
      case 'map.fly_to':
        if ('center' in event.arguments) {
          context.map?.flyTo(event.arguments)
        } else {
          const center = context.resolveCity?.(event.arguments.city)
          if (!center) throw new Error(`无法解析城市坐标：${event.arguments.city}`)
          context.map?.flyTo({ center, zoom: event.arguments.zoom, duration: event.arguments.duration })
        }
        break
      case 'chart.render':
        result.chartCity = event.arguments.city
        result.modelChart = event.arguments.chart === 'model-comparison'
        break
    }
  }

  return result
}

