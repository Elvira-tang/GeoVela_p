import { useDeferredValue, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, Download, Search, Table } from 'lucide-react'
import { resolveVectorGeoJSON } from '@/services/geo'
import { useMapStore } from '@/stores/mapStore'

const PAGE_SIZE = 100

function displayValue(value: unknown): string {
  if (value == null) return ''
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

function csvCell(value: unknown): string {
  let text = displayValue(value)
  // Spreadsheet programs may execute formulas in imported CSV cells.
  if (/^\s*[=+\-@]/.test(text)) text = "'" + text
  return '"' + text.replace(/"/g, '""') + '"'
}

/** Attribute table shared by the desktop panel and the browser edition. */
export function DataTable() {
  const layers = useMapStore((state) => state.layers)
  const activeLayerId = useMapStore((state) => state.activeLayerId)
  const setActiveLayer = useMapStore((state) => state.setActiveLayer)
  const [search, setSearch] = useState('')
  const deferredSearch = useDeferredValue(search)
  const [page, setPage] = useState(0)
  const [sort, setSort] = useState<{ field: string; direction: 1 | -1 } | null>(null)

  const selectedLayer = layers.find((layer) => layer.id === activeLayerId)
    ?? layers.find((layer) => layer.data.kind === 'vector')
    ?? layers[0]
  const vector = selectedLayer?.data.kind === 'vector' ? selectedLayer.data : null
  const features = useMemo(() => {
    if (!vector) return []
    try {
      return resolveVectorGeoJSON(vector).features
    } catch {
      return vector.geojson.features
    }
  }, [vector])
  const fields = useMemo(() => {
    if (!vector) return []
    const names = vector.fields.map((field) => field.name)
    return names.length ? names : Object.keys(features[0]?.properties ?? {})
  }, [vector, features])
  const rows = useMemo(() => {
    const needle = deferredSearch.trim().toLocaleLowerCase()
    const filtered = needle
      ? features.filter((feature) => fields.some((field) =>
          displayValue(feature.properties?.[field]).toLocaleLowerCase().includes(needle)))
      : features
    if (!sort) return filtered
    const collator = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' })
    return [...filtered].sort((a, b) =>
      collator.compare(
        displayValue(a.properties?.[sort.field]),
        displayValue(b.properties?.[sort.field]),
      ) * sort.direction)
  }, [features, fields, deferredSearch, sort])
  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE))
  const safePage = Math.min(page, pageCount - 1)
  const visibleRows = rows.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE)

  const exportCsv = () => {
    if (!selectedLayer || !vector) return
    const lines = [fields.map(csvCell).join(',')]
    for (const feature of rows) {
      lines.push(fields.map((field) => csvCell(feature.properties?.[field])).join(','))
    }
    const blob = new Blob(['\uFEFF', lines.join('\r\n')], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = selectedLayer.name.replace(/[\\/:*?"<>|]/g, '_') + '-attributes.csv'
    document.body.appendChild(link)
    link.click()
    link.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-bg-primary text-text-primary">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border bg-bg-secondary px-3 py-2">
        <Table className="h-4 w-4 text-accent-primary" />
        <span className="text-sm font-medium">属性表</span>
        <select
          aria-label="选择图层"
          className="h-8 max-w-56 rounded border border-border bg-bg-primary px-2 text-xs"
          value={selectedLayer?.id ?? ''}
          onChange={(event) => {
            setActiveLayer(event.target.value)
            setPage(0)
            setSort(null)
            setSearch('')
          }}
          disabled={!layers.length}
        >
          {!layers.length && <option value="">暂无图层</option>}
          {layers.map((layer) => <option key={layer.id} value={layer.id}>{layer.name}</option>)}
        </select>
        {vector && (
          <>
            <label className="ml-auto flex h-8 min-w-0 items-center gap-1 rounded border border-border bg-bg-primary px-2 text-text-muted">
              <Search className="h-3.5 w-3.5 shrink-0" />
              <input
                aria-label="搜索属性"
                className="w-32 bg-transparent text-xs text-text-primary outline-none sm:w-44"
                value={search}
                onChange={(event) => { setSearch(event.target.value); setPage(0) }}
                placeholder="搜索属性"
              />
            </label>
            <button
              onClick={exportCsv}
              className="flex h-8 items-center gap-1 rounded bg-accent-primary px-3 text-xs text-white hover:brightness-110"
              title="将当前筛选结果导出为 CSV"
            >
              <Download className="h-3.5 w-3.5" />
              导出 CSV
            </button>
          </>
        )}
      </div>

      {!selectedLayer ? (
        <div className="flex flex-1 items-center justify-center text-sm text-text-muted">先在地图页导入数据文件。</div>
      ) : !vector ? (
        <div className="flex flex-1 items-center justify-center text-sm text-text-muted">该图层是栅格数据，没有矢量属性表。</div>
      ) : (
        <>
          <div className="min-h-0 flex-1 overflow-auto">
            <table className="w-full border-collapse text-left text-xs">
              <thead className="sticky top-0 z-10 bg-bg-secondary text-text-secondary">
                <tr>
                  <th className="w-14 border-b border-r border-border px-3 py-2">#</th>
                  {fields.map((field) => (
                    <th key={field} className="min-w-32 border-b border-r border-border px-3 py-2">
                      <button
                        className="flex items-center gap-1 text-left hover:text-accent-primary"
                        onClick={() => { setSort((current) => ({ field, direction: current?.field === field && current.direction === 1 ? -1 : 1 })); setPage(0) }}
                        title={'按 ' + field + ' 排序'}
                      >
                        {field}{sort?.field === field ? (sort.direction === 1 ? ' ↑' : ' ↓') : ''}
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((feature, index) => (
                  <tr key={selectedLayer.id + '-' + (safePage * PAGE_SIZE + index)} className="even:bg-bg-secondary/40 hover:bg-accent-primary/10">
                    <td className="border-b border-r border-border px-3 py-1.5 text-text-muted">{safePage * PAGE_SIZE + index + 1}</td>
                    {fields.map((field) => (
                      <td key={field} className="max-w-80 truncate border-b border-r border-border px-3 py-1.5" title={displayValue(feature.properties?.[field])}>
                        {displayValue(feature.properties?.[field])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            {!rows.length && <p className="p-5 text-center text-sm text-text-muted">没有匹配的记录。</p>}
          </div>
          <div className="flex shrink-0 items-center justify-between border-t border-border bg-bg-secondary px-3 py-2 text-xs text-text-muted">
            <span>{rows.length} 条记录 · {fields.length} 个字段{vector.sampled ? ' · 当前显示数据样本' : ''}</span>
            <div className="flex items-center gap-2">
              <button aria-label="上一页" disabled={safePage === 0} onClick={() => setPage(safePage - 1)} className="rounded p-1 hover:bg-bg-hover disabled:opacity-40"><ChevronLeft className="h-4 w-4" /></button>
              <span>第 {safePage + 1} / {pageCount} 页</span>
              <button aria-label="下一页" disabled={safePage >= pageCount - 1} onClick={() => setPage(safePage + 1)} className="rounded p-1 hover:bg-bg-hover disabled:opacity-40"><ChevronRight className="h-4 w-4" /></button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
