import { LayerPanel } from '@/features/layers/LayerPanel'
import { MapView } from '@/features/map/MapView'
import { useMapStore } from '@/stores/mapStore'
import { useSettingsStore } from '@/stores/settingsStore'

/** Browser edition: local map exploration without Electron or the Python sidecar. */
export default function WebApp() {
  const showMapLabels = useSettingsStore((state) => state.appearance.showMapLabels)
  const updateAppearance = useSettingsStore((state) => state.updateAppearance)
  const basemap = useMapStore((state) => state.basemap)

  return (
    <div className="flex h-screen min-h-0 flex-col bg-bg-primary text-text-primary">
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border bg-bg-secondary px-4 py-2">
        <div className="flex items-baseline gap-3">
          <h1 className="font-display text-lg font-semibold">GeoVela</h1>
          <span className="text-xs text-text-muted">在线地图试用版</span>
        </div>
        <label className="flex items-center gap-2 text-xs text-text-secondary">
          <input
            type="checkbox"
            checked={showMapLabels}
            onChange={(event) => updateAppearance({ showMapLabels: event.target.checked })}
          />
          显示底图地名
        </label>
      </header>
      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <aside className="h-44 min-h-0 shrink-0 border-b border-border md:h-auto md:w-72 md:border-b-0 md:border-r">
          <LayerPanel />
        </aside>
        <main className="min-h-0 min-w-0 flex-1">
          <MapView />
        </main>
      </div>
      <footer className="shrink-0 border-t border-border bg-bg-secondary px-4 py-1 text-[11px] text-text-muted">
        在左侧添加 GeoJSON、CSV 或其他支持的地图文件；刷新页面会清除本次导入的图层。
        <span className="ml-3">{basemap.attribution}{basemap.attribution.includes('OpenStreetMap') ? '' : ' · © OpenStreetMap contributors'}</span>
      </footer>
    </div>
  )
}
