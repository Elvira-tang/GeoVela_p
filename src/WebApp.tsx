import { useEffect, useState } from 'react'
import { Bot, FileUp, FolderOpen, GitBranch, History, KeyRound, Layers3, Map as MapIcon, PlugZap, Server, Settings2, Sparkles, Table } from 'lucide-react'
import { DataTable } from '@/features/data/DataTable'
import { LayerPanel } from '@/features/layers/LayerPanel'
import { MapView } from '@/features/map/MapView'
import { GeoAgentWorkspace } from '@/features/web-agent/GeoAgentWorkspace'
import { WebControlCenter } from '@/features/web-control/WebControlCenter'
import { ApiSettingsPage, McpPage, PluginsPage, SkillsPage } from '@/features/web-control/ManagementPages'
import { ApprovalGate } from '@/features/approval/ApprovalGate'
import { useWebAgentConfigStore } from '@/stores/webAgentConfigStore'
import { useMapStore } from '@/stores/mapStore'
import { BUILTIN_BASEMAPS } from '@/services/geo'

type WebView = 'agent' | 'map' | 'table' | 'plugins' | 'mcp' | 'api' | 'workflows' | 'skills' | 'runs'
const PRIMARY = [{ id: 'agent' as const, label: 'Geo Agent', icon: Bot }, { id: 'map' as const, label: '地图与图层', icon: MapIcon }, { id: 'table' as const, label: '数据表', icon: Table }]

export default function WebApp() {
  const [activeView, setActiveView] = useState<WebView>('agent')
  const language = useWebAgentConfigStore((state) => state.config.language)
  useEffect(() => {
    const id = 'carto-dark'
    const basemap = BUILTIN_BASEMAPS.find((item) => item.id === id)
    if (basemap) useMapStore.getState().setBasemap(basemap)
  }, [language])
  useEffect(() => { const open = () => setActiveView('agent'); window.addEventListener('geovela:run-workflow', open); return () => window.removeEventListener('geovela:run-workflow', open) }, [])
  useEffect(() => { const navigate = (event: Event) => setActiveView((event as CustomEvent<WebView>).detail); window.addEventListener('geovela:navigate', navigate); return () => window.removeEventListener('geovela:navigate', navigate) }, [])
  const openPicker = (eventName: string) => { setActiveView('agent'); window.setTimeout(() => window.dispatchEvent(new CustomEvent(eventName)), 50) }
  return <div className="flex h-screen min-h-0 bg-[#f5f5f2] text-text-primary">
    <aside className="z-30 flex w-[52px] shrink-0 flex-col border-r border-white/10 bg-[#202328] text-[#9ba0a7]">
      <div className="grid h-12 place-items-center border-b border-white/10 text-cyan-300" title="GeoVela"><Sparkles className="h-5 w-5" /></div>
      <nav className="space-y-1 p-1.5">{PRIMARY.map(({ id, label, icon }) => <NavButton key={id} open={false} active={activeView === id} icon={icon} label={label} onClick={() => setActiveView(id)} />)}</nav>
      <div className="mx-2 border-t border-white/10" />
      <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
        <NavButton open={false} icon={FolderOpen} label="选择文件夹" onClick={() => openPicker('geovela:choose-folder')} />
        <NavButton open={false} icon={FileUp} label="导入 GIS 数据" onClick={() => openPicker('geovela:import-files')} />
        <NavButton open={false} active={activeView === 'plugins'} icon={PlugZap} label="插件" onClick={() => setActiveView('plugins')} />
        <NavButton open={false} active={activeView === 'mcp'} icon={Server} label="MCP Servers" onClick={() => setActiveView('mcp')} />
        <NavButton open={false} active={activeView === 'api'} icon={KeyRound} label="模型 API" onClick={() => setActiveView('api')} />
        <NavButton open={false} active={activeView === 'workflows'} icon={GitBranch} label="Workflows" onClick={() => setActiveView('workflows')} />
        <NavButton open={false} active={activeView === 'skills'} icon={Layers3} label="Skills" onClick={() => setActiveView('skills')} />
        <NavButton open={false} active={activeView === 'runs'} icon={History} label="运行记录" onClick={() => setActiveView('runs')} />
      </div>
      <div className="border-t border-white/10 p-1.5"><NavButton open={false} icon={Settings2} label="Agent 设置" onClick={() => setActiveView('api')} /></div>
    </aside>
    <main className="relative min-h-0 min-w-0 flex-1 bg-white">
      <div className={`absolute inset-0 ${activeView === 'agent' ? '' : 'pointer-events-none invisible'}`}><GeoAgentWorkspace /></div>
      {activeView === 'map' && <div className="absolute inset-0 flex"><aside className="w-[280px] shrink-0 border-r border-border bg-bg-primary"><LayerPanel /></aside><div className="relative min-w-0 flex-1"><MapView /></div></div>}
      {activeView === 'table' && <div className="absolute inset-0"><DataTable /></div>}
      {activeView === 'plugins' && <PluginsPage />}{activeView === 'mcp' && <McpPage />}{activeView === 'api' && <ApiSettingsPage />}{activeView === 'workflows' && <WebControlCenter only="workflows" />}{activeView === 'skills' && <SkillsPage />}{activeView === 'runs' && <WebControlCenter only="runs" />}
    </main><ApprovalGate />
  </div>
}

function NavButton({ open, active = false, icon: Icon, label, onClick }: { open: boolean; active?: boolean; icon: typeof Bot; label: string; onClick: () => void }) { return <button onClick={onClick} title={label} className={`flex w-full items-center justify-center rounded px-2 py-2.5 text-xs hover:bg-white/10 hover:text-white ${active ? 'border-l-2 border-cyan-400 bg-white/10 text-white' : 'text-[#9ba0a7]'}`}><Icon className="h-[18px] w-[18px] shrink-0" />{open && <span className="truncate">{label}</span>}</button> }
