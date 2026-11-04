import { useState } from 'react'
import { LayoutTemplate, Map as MapIcon, Table } from 'lucide-react'
import { DataTable } from '@/features/data/DataTable'
import { LayerPanel } from '@/features/layers/LayerPanel'
import { LayoutComposerView } from '@/features/layout-composer/LayoutComposerView'
import { captureCurrentMapSnapshot, captureMapSnapshotAfterIdle } from '@/features/layout-composer/mapSnapshot'
import { MapView } from '@/features/map/MapView'
import { useMapStore } from '@/stores/mapStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { useLayoutComposerStore } from '@/features/layout-composer/layoutComposerStore'

type WebView = 'map' | 'table' | 'layout'

const VIEWS: Array<{ id: WebView; label: string; icon: typeof MapIcon }> = [
  { id: 'map', label: '地图与图层样式', icon: MapIcon },
  { id: 'table', label: '属性表', icon: Table },
  { id: 'layout', label: '制图画布', icon: LayoutTemplate },
]

/** Browser edition: local GIS editing without Electron or the Python sidecar. */
export default function WebApp() {
  const [activeView, setActiveView] = useState<WebView>('map')
  const showMapLabels = useSettingsStore((state) => state.appearance.showMapLabels)
  const updateAppearance = useSettingsStore((state) => state.updateAppearance)
  const basemap = useMapStore((state) => state.basemap)
  const setMapSnapshotUrl = useLayoutComposerStore((state) => state.setMapSnapshotUrl)

  const switchView = (next: WebView) => {
    if (next === 'layout') {
      const snapshot = captureCurrentMapSnapshot()
      if (snapshot) setMapSnapshotUrl(snapshot)
      void captureMapSnapshotAfterIdle().then((settledSnapshot) => {
        if (settledSnapshot) setMapSnapshotUrl(settledSnapshot)
      })
    }
    setActiveView(next)
  }

  return (
    <div className="flex h-screen min-h-0 flex-col bg-bg-primary text-text-primary">
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border bg-bg-secondary px-4 py-2">
        <div className="flex items-baseline gap-3">
          <h1 className="font-display text-lg font-semibold">GeoVela</h1>
          <span className="text-xs text-text-muted">在线 GIS 试用版</span>
        </div>
        <nav aria-label="网页功能" className="flex flex-wrap items-center gap-1">
          {VIEWS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => switchView(id)}
              aria-current={activeView === id ? 'page' : undefined}
              className={`flex items-center gap-1.5 rounded px-2.5 py-1.5 text-xs transition-colors ${activeView === id ? 'bg-accent-primary text-white' : 'text-text-secondary hover:bg-bg-hover'}`}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </button>
          ))}
        </nav>
        {activeView === 'map' && (
          <label className="flex items-center gap-2 text-xs text-text-secondary">
            <input
              type="checkbox"
              checked={showMapLabels}
              onChange={(event) => updateAppearance({ showMapLabels: event.target.checked })}
            />
            显示底图地名
          </label>
        )}
      </header>
      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        {activeView === 'map' && (
          <aside className="h-40 shrink-0 border-b border-border md:h-auto md:w-72 md:border-b-0 md:border-r">
            <LayerPanel />
          </aside>
        )}
        <main className="relative min-h-0 min-w-0 flex-1">
          <div
            className={`absolute inset-0 ${activeView === 'map' ? '' : 'pointer-events-none opacity-0'}`}
            aria-hidden={activeView !== 'map'}
            ref={(element) => { if (element) element.inert = activeView !== 'map' }}
          >
            <MapView />
          </div>
          {activeView === 'table' && <div className="absolute inset-0 z-10 bg-bg-primary"><DataTable /></div>}
          {activeView === 'layout' && <div className="absolute inset-0 z-10 bg-bg-primary"><LayoutComposerView /></div>}
        </main>
      </div>
      <footer className="shrink-0 border-t border-border bg-bg-secondary px-4 py-1 text-[11px] text-text-muted">
        {activeView === 'map'
          ? '添加地图文件后，展开左侧图层可调整样式；地图工具栏可导出 PNG 或 JPG。'
          : activeView === 'table'
            ? '属性表可搜索、排序并导出 CSV。'
            : '制图画布可添加图例、比例尺、文字等元素并导出 PNG。'}
        <span className="ml-2">刷新页面会清除本次导入的图层。</span>
        <span className="ml-3">{basemap.attribution}{basemap.attribution?.includes('OpenStreetMap') ? '' : ' · © OpenStreetMap contributors'}</span>
      </footer>
    </div>
  )
}
