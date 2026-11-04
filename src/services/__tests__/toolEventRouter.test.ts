import { describe, expect, it, vi } from 'vitest'
import { executeToolEvents } from '../toolEventRouter'

describe('agent tool event router', () => {
  it('executes validated map, weather and chart events in order', () => {
    const selectCity = vi.fn()
    const setMetric = vi.fn()
    const flyTo = vi.fn()
    const fitBounds = vi.fn()

    const result = executeToolEvents([
      { type: 'tool_call', tool: 'weather.select_city', arguments: { city: '无锡' } },
      { type: 'tool_call', tool: 'weather.set_metric', arguments: { metric: 'maxTemperatureC' } },
      { type: 'tool_call', tool: 'map.fly_to', arguments: { center: [120.31, 31.49], zoom: 8.5, duration: 900 } },
      { type: 'tool_call', tool: 'chart.render', arguments: { city: '无锡', chart: 'temperature' } },
    ], { map: { flyTo, fitBounds }, selectCity, setMetric })

    expect(selectCity).toHaveBeenCalledWith('无锡')
    expect(setMetric).toHaveBeenCalledWith('maxTemperatureC')
    expect(flyTo).toHaveBeenCalledWith({ center: [120.31, 31.49], zoom: 8.5, duration: 900 })
    expect(result).toEqual({
      tools: ['weather.select_city', 'weather.set_metric', 'map.fly_to', 'chart.render'],
      chartCity: '无锡',
      modelChart: false,
    })
  })

  it('rejects malformed or out-of-range tool arguments before execution', () => {
    const flyTo = vi.fn()
    expect(() => executeToolEvents([
      { type: 'tool_call', tool: 'map.fly_to', arguments: { center: [500, 31.49], zoom: 8.5, duration: 900 } },
    ], { map: { flyTo, fitBounds: vi.fn() }, selectCity: vi.fn(), setMetric: vi.fn() })).toThrow()
    expect(flyTo).not.toHaveBeenCalled()
  })
})
