export type ProjectFileKind = 'folder' | 'csv' | 'script' | 'workflow' | 'report' | 'image' | 'geojson' | 'file'

export interface ProjectEntry {
  path: string
  name: string
  kind: ProjectFileKind
  parent: string | null
  content?: string
  updatedAt: number
}

const DB_NAME = 'geovela-project-fs'
const STORE = 'entries'
const VERSION = 1

const weatherCsv = `城市,省份,经度,纬度,最高温度,最低温度,降水量,天气
北京,北京,116.4074,39.9042,18,7,0.0,晴
上海,上海,121.4737,31.2304,21,13,1.2,多云
广州,广东,113.2644,23.1291,27,19,4.8,阵雨
深圳,广东,114.0579,22.5431,28,20,2.1,多云
成都,四川,104.0665,30.5723,20,12,0.6,阴
武汉,湖北,114.3055,30.5928,22,11,0.0,晴
西安,陕西,108.9398,34.3416,17,6,0.0,晴
南京,江苏,118.7969,32.0603,20,10,0.3,多云
杭州,浙江,120.1551,30.2741,22,12,1.0,小雨
乌鲁木齐,新疆,87.6168,43.8256,9,-1,0.0,晴`

const milkTeaCsv = `名称,品牌,行政区,经度,纬度,评分,人均消费,门店类型
喜茶·无锡恒隆店,喜茶,梁溪区,120.3026,31.5687,4.7,29,连锁
奈雪的茶·苏宁广场店,奈雪的茶,梁溪区,120.3062,31.5662,4.6,31,连锁
霸王茶姬·南长街店,霸王茶姬,梁溪区,120.3128,31.5551,4.8,24,连锁
茶百道·中山路店,茶百道,梁溪区,120.2998,31.5756,4.5,18,连锁
沪上阿姨·清扬路店,沪上阿姨,梁溪区,120.3094,31.5488,4.4,17,连锁
一点点·滨湖万达店,一点点,滨湖区,120.2731,31.5202,4.5,16,连锁
古茗·蠡湖店,古茗,滨湖区,120.2587,31.5066,4.6,17,连锁
茉莉奶白·海岸城店,茉莉奶白,滨湖区,120.2968,31.4973,4.7,22,连锁
益禾堂·江南大学店,益禾堂,滨湖区,120.2755,31.4841,4.3,13,校园
蜜雪冰城·太湖学院店,蜜雪冰城,滨湖区,120.2294,31.5421,4.4,9,校园
书亦烧仙草·长江北路店,书亦烧仙草,新吴区,120.3521,31.5529,4.5,15,连锁
CoCo都可·新地假日店,CoCo都可,新吴区,120.3617,31.5458,4.4,17,连锁
七分甜·梅村店,七分甜,新吴区,120.4285,31.5502,4.6,19,连锁
甜啦啦·硕放店,甜啦啦,新吴区,120.3578,31.4924,4.2,10,社区
茶颜悦色·惠山万达店,茶颜悦色,惠山区,120.2982,31.6815,4.8,23,连锁
桂源铺·洛社店,桂源铺,惠山区,120.2125,31.6418,4.3,18,社区
厝内小眷村·锡山店,厝内小眷村,锡山区,120.3579,31.5882,4.5,20,连锁
悸动烧仙草·东亭店,悸动烧仙草,锡山区,120.3571,31.5939,4.4,14,社区`

function seedEntries(): ProjectEntry[] {
  const now = Date.now()
  const result: ProjectEntry[] = []
  for (const project of ['全国天气', '无锡市奶茶店分布']) {
    result.push({ path: `Data/${project}`, name: project, kind: 'folder', parent: 'Data', updatedAt: now })
    for (const folder of ['data', 'script', 'workflow', 'output', 'report']) {
      result.push({ path: `Data/${project}/${folder}`, name: folder, kind: 'folder', parent: `Data/${project}`, updatedAt: now })
    }
  }
  result.unshift({ path: 'Data', name: 'Data', kind: 'folder', parent: null, updatedAt: now })
  result.push({ path: 'Data/全国天气/data/全国天气.csv', name: '全国天气.csv', kind: 'csv', parent: 'Data/全国天气/data', content: weatherCsv, updatedAt: now })
  result.push({ path: 'Data/无锡市奶茶店分布/data/无锡市奶茶店分布.csv', name: '无锡市奶茶店分布.csv', kind: 'csv', parent: 'Data/无锡市奶茶店分布/data', content: milkTeaCsv, updatedAt: now })
  return result
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, VERSION)
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: 'path' })
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function transact<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore, done: (value: T) => void) => void): Promise<T> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode)
    action(tx.objectStore(STORE), resolve)
    tx.onerror = () => reject(tx.error)
    tx.oncomplete = () => db.close()
  })
}

export const browserProjectFs = {
  async init() {
    const entries = await this.list()
    if (!entries.length) await transact<void>('readwrite', (store, done) => { seedEntries().forEach((entry) => store.put(entry)); done() })
    return this.list()
  },
  list(): Promise<ProjectEntry[]> {
    return transact('readonly', (store, done) => { const request = store.getAll(); request.onsuccess = () => done(request.result as ProjectEntry[]) })
  },
  read(path: string): Promise<ProjectEntry | undefined> {
    return transact('readonly', (store, done) => { const request = store.get(path); request.onsuccess = () => done(request.result as ProjectEntry | undefined) })
  },
  write(entry: Omit<ProjectEntry, 'updatedAt'>) {
    return transact<void>('readwrite', (store, done) => { store.put({ ...entry, updatedAt: Date.now() }); done() })
  },
  async remove(path: string) {
    const entries = await this.list(); const targets = entries.filter((entry) => entry.path === path || entry.path.startsWith(`${path}/`))
    return transact<void>('readwrite', (store, done) => { targets.forEach((entry) => store.delete(entry.path)); done() })
  },
  async rename(path: string, nextName: string) {
    const entries = await this.list(); const current = entries.find((entry) => entry.path === path); if (!current) return
    const prefix = current.parent ? `${current.parent}/${nextName}` : nextName
    await this.remove(path)
    for (const entry of entries.filter((item) => item.path === path || item.path.startsWith(`${path}/`))) {
      const nextPath = `${prefix}${entry.path.slice(path.length)}`; const parent = entry.path === path ? current.parent : entry.parent?.replace(path, prefix) ?? null
      await this.write({ ...entry, path: nextPath, name: entry.path === path ? nextName : entry.name, parent })
    }
  },
}

export function parseCsv(text: string): Array<Record<string, string>> {
  const lines = text.trim().split(/\r?\n/); const fields = lines.shift()?.split(',').map((item) => item.trim()) ?? []
  return lines.map((line) => Object.fromEntries(line.split(',').map((value, index) => [fields[index], value.trim()])))
}
