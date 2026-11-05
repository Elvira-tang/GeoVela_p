export type ProjectFileKind = 'folder' | 'csv' | 'script' | 'workflow' | 'report' | 'image' | 'geojson' | 'file'

export interface ProjectEntry {
  path: string
  name: string
  kind: ProjectFileKind
  parent: string | null
  content?: string
  updatedAt: number
}

const DB_NAME = 'geovela-project-fs-v2'
const STORE = 'entries'
const VERSION = 1

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

export function workspaceUri(path: string) {
  return `workspace://${path}`
}

export function pathFromWorkspaceUri(uri: string) {
  if (!uri.startsWith('workspace://')) return uri
  const value = uri.slice('workspace://'.length)
  try { return decodeURIComponent(value) } catch { return value }
}

export async function importBrowserDirectory(files: File[]) {
  if (!files.length) return []
  const all = await browserProjectFs.list()
  for (const entry of all) await browserProjectFs.remove(entry.path)
  const paths = new Set<string>()
  for (const file of files) {
    const relative = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name
    const parts = relative.split('/').filter(Boolean)
    for (let index = 0; index < parts.length - 1; index += 1) {
      const path = parts.slice(0, index + 1).join('/')
      if (!paths.has(path)) {
        paths.add(path)
        await browserProjectFs.write({ path, name: parts[index], kind: 'folder', parent: index ? parts.slice(0, index).join('/') : null })
      }
    }
    const path = parts.join('/'); const extension = file.name.split('.').pop()?.toLowerCase()
    const kind: ProjectFileKind = extension === 'csv' ? 'csv' : extension === 'geojson' || extension === 'json' ? 'geojson' : extension === 'py' || extension === 'js' || extension === 'ts' ? 'script' : extension === 'md' ? 'report' : 'file'
    await browserProjectFs.write({ path, name: file.name, kind, parent: parts.length > 1 ? parts.slice(0, -1).join('/') : null, content: await file.text() })
  }
  return browserProjectFs.list()
}

export function parseCsv(text: string): Array<Record<string, string>> {
  const lines = text.trim().split(/\r?\n/); const fields = lines.shift()?.split(',').map((item) => item.trim()) ?? []
  return lines.map((line) => Object.fromEntries(line.split(',').map((value, index) => [fields[index], value.trim()])))
}
