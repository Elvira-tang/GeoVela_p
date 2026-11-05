import React from 'react'
import ReactDOM from 'react-dom/client'
import WebApp from './WebApp'
import './theme/globals.css'
import { BUILTIN_BASEMAPS } from './services/geo'
import { useMapStore } from './stores/mapStore'
import { useSettingsStore } from './stores/settingsStore'

useSettingsStore.getState().updateAppearance({
  language: 'zh',
  basemapId: 'carto-dark',
  showMapLabels: true,
})
const webBasemap = BUILTIN_BASEMAPS.find((source) => source.id === 'carto-dark')
if (webBasemap) useMapStore.getState().setBasemap(webBasemap)

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <WebApp />
  </React.StrictMode>,
)
