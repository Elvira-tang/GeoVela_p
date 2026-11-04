import React from 'react'
import ReactDOM from 'react-dom/client'
import WebApp from './WebApp'
import './theme/globals.css'
import { BUILTIN_BASEMAPS } from './services/geo'
import { useMapStore } from './stores/mapStore'
import { useSettingsStore } from './stores/settingsStore'

useSettingsStore.getState().updateAppearance({
  language: 'zh',
  basemapId: 'carto-voyager',
  showMapLabels: true,
})
const labeledBasemap = BUILTIN_BASEMAPS.find((source) => source.id === 'carto-voyager')
if (labeledBasemap) useMapStore.getState().setBasemap(labeledBasemap)

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <WebApp />
  </React.StrictMode>,
)
