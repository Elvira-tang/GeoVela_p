export interface WebSkillManifest {
  id: string
  name: string
  description: string
  tools: string[]
  enabled: boolean
  version: string
}

export interface WebWorkflowNode { id: string; name: string; skillId: string; dependsOn: string[] }
export interface WebWorkflow { id: string; name: string; description: string; nodes: WebWorkflowNode[]; updatedAt: string }
export interface WebRunRecord { id: string; prompt: string; model: string; status: 'success' | 'error' | 'cancelled'; startedAt: string; durationMs: number; tools: string[]; events: number; answer?: string; error?: string }

const SKILLS_KEY = 'geovela.web.skills.v1'
const WORKFLOWS_KEY = 'geovela.web.workflows.v1'
const RUNS_KEY = 'geovela.web.runs.v1'

const BUILTIN_SKILLS: WebSkillManifest[] = [
  { id: 'weather-analysis', name: '全国天气分析', description: '获取近五日和未来五日天气，生成地图、趋势图和数据表。', tools: ['weather.get_recent', 'weather.get_forecast', 'map.add_geojson_layer', 'chart.render', 'table.show'], enabled: true, version: '1.0.0' },
  { id: 'milk-tea-poi', name: '奶茶店 POI', description: '在经审批后搜索当前地图范围内的奶茶店并渲染图层。', tools: ['poi.search_milk_tea', 'map.fly_to', 'map.add_geojson_layer', 'table.show'], enabled: true, version: '1.0.0' },
]

function read<T>(key: string, fallback: T): T {
  try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) as T : fallback } catch { return fallback }
}
function write<T>(key: string, value: T) { localStorage.setItem(key, JSON.stringify(value)); window.dispatchEvent(new CustomEvent('geovela:control-plane')) }

export const webControlPlane = {
  skills: () => read<WebSkillManifest[]>(SKILLS_KEY, BUILTIN_SKILLS),
  saveSkills: (items: WebSkillManifest[]) => write(SKILLS_KEY, items),
  workflows: () => read<WebWorkflow[]>(WORKFLOWS_KEY, []),
  saveWorkflows: (items: WebWorkflow[]) => write(WORKFLOWS_KEY, items),
  runs: () => read<WebRunRecord[]>(RUNS_KEY, []),
  recordRun: (run: WebRunRecord) => write(RUNS_KEY, [run, ...read<WebRunRecord[]>(RUNS_KEY, [])].slice(0, 100)),
  clearRuns: () => write(RUNS_KEY, []),
}

export function validateWorkflow(workflow: WebWorkflow): string[] {
  const ids = new Set(workflow.nodes.map((node) => node.id))
  const errors = workflow.nodes.flatMap((node) => node.dependsOn.filter((id) => !ids.has(id)).map((id) => `${node.name} 依赖不存在的节点 ${id}`))
  const visiting = new Set<string>(); const visited = new Set<string>()
  const visit = (id: string): boolean => {
    if (visiting.has(id)) return true
    if (visited.has(id)) return false
    visiting.add(id)
    const node = workflow.nodes.find((item) => item.id === id)
    if (node?.dependsOn.some(visit)) return true
    visiting.delete(id); visited.add(id); return false
  }
  if (workflow.nodes.some((node) => visit(node.id))) errors.push('工作流包含循环依赖')
  return errors
}

export function orderWorkflowNodes(workflow: WebWorkflow): WebWorkflowNode[] {
  const pending = new Map(workflow.nodes.map((node) => [node.id, node]))
  const done = new Set<string>(); const ordered: WebWorkflowNode[] = []
  while (pending.size) {
    const ready = [...pending.values()].filter((node) => node.dependsOn.every((id) => done.has(id)))
    if (!ready.length) throw new Error('工作流包含循环或无效依赖')
    for (const node of ready) { ordered.push(node); done.add(node.id); pending.delete(node.id) }
  }
  return ordered
}
