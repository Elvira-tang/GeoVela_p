import { create } from 'zustand'
import { loadGeoFiles, type MapLayerDefinition } from '@/services/geo'
import { useMapStore } from '@/stores/mapStore'

export interface WorkspaceDataset {
  id: string; projectId: string; name: string; kind: 'vector' | 'raster' | 'table'; source: 'upload' | 'weather-example' | 'poi-example'; status: 'available' | 'loading' | 'open' | 'error'; layerId?: string; featureCount?: number; fields?: string[]; error?: string
}
export interface WorkspaceProject { id: string; name: string; example?: boolean; description: string }

const projects: WorkspaceProject[] = [
  { id: 'weather-example', name: '全国天气', example: true, description: 'Open-Meteo 近五日与未来五日城市天气示例' },
  { id: 'poi-example', name: '奶茶店 POI', example: true, description: 'OpenStreetMap 当前地图范围 POI 示例' },
]
const initialDatasets: WorkspaceDataset[] = [
  { id: 'weather-cities', projectId: 'weather-example', name: '全国城市天气.geojson', kind: 'vector', source: 'weather-example', status: 'available' },
  { id: 'milk-tea-poi', projectId: 'poi-example', name: '奶茶店 POI.geojson', kind: 'vector', source: 'poi-example', status: 'available' },
]

interface WorkspaceState {
  projects: WorkspaceProject[]; datasets: WorkspaceDataset[]; activeProjectId: string | null; activeDatasetId: string | null
  selectProject: (id: string) => void; setDataset: (id: string, patch: Partial<WorkspaceDataset>) => void; closeDataset: (id: string) => void
  importFiles: (files: File[]) => Promise<void>; registerLayer: (datasetId: string, layer: MapLayerDefinition) => void
}

export const useWebWorkspaceStore = create<WorkspaceState>((set, get) => ({
  projects, datasets: initialDatasets, activeProjectId: null, activeDatasetId: null,
  selectProject: (activeProjectId) => set({ activeProjectId }),
  setDataset: (id, patch) => set((state) => ({ datasets: state.datasets.map((item) => item.id === id ? { ...item, ...patch } : item) })),
  registerLayer: (datasetId, layer) => {
    useMapStore.getState().addLayer(layer)
    set((state) => ({ activeProjectId: state.datasets.find((item) => item.id === datasetId)?.projectId ?? state.activeProjectId, activeDatasetId: datasetId, datasets: state.datasets.map((item) => item.id === datasetId ? { ...item, status: 'open', layerId: layer.id, featureCount: layer.data.kind === 'vector' ? layer.data.featureCount : undefined, fields: layer.data.kind === 'vector' ? layer.data.fields.map((field) => field.name) : [] } : item) }))
  },
  closeDataset: (id) => {
    const dataset = get().datasets.find((item) => item.id === id)
    if (dataset?.layerId) useMapStore.getState().removeLayer(dataset.layerId)
    set((state) => ({ activeDatasetId: state.activeDatasetId === id ? null : state.activeDatasetId, datasets: state.datasets.map((item) => item.id === id ? { ...item, status: 'available', layerId: undefined } : item) }))
  },
  importFiles: async (files) => {
    if (!files.length) return
    const relative = (files[0] as File & { webkitRelativePath?: string }).webkitRelativePath ?? ''
    const folderName = relative.split('/')[0] || '我的数据'
    const projectId = `upload-${folderName.replace(/[^\w\u4e00-\u9fa5-]/g, '-').toLowerCase()}`
    if (!get().projects.some((item) => item.id === projectId)) set((state) => ({ projects: [...state.projects, { id: projectId, name: folderName, description: '用户导入的浏览器数据文件夹' }], activeProjectId: projectId }))
    const layers = await loadGeoFiles(files)
    useMapStore.getState().addLayers(layers)
    set((state) => ({ activeProjectId: projectId, activeDatasetId: layers[layers.length - 1]?.id ?? null, datasets: [...state.datasets, ...layers.map((layer) => ({ id: layer.id, projectId, name: layer.meta.fileName, kind: layer.data.kind, source: 'upload' as const, status: 'open' as const, layerId: layer.id, featureCount: layer.data.kind === 'vector' ? layer.data.featureCount : undefined, fields: layer.data.kind === 'vector' ? layer.data.fields.map((field) => field.name) : [] }))] }))
  },
}))
