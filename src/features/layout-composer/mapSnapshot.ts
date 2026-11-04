import { mapEngine } from '@/features/map/engine/MapEngine'

export function captureCurrentMapSnapshot(): string | null {
  const map = mapEngine.getMap()
  if (!map) return null
  try {
    map.triggerRepaint()
    return map.getCanvas().toDataURL('image/png')
  } catch (err) {
    console.warn('[layoutComposer] Failed to capture current map snapshot:', err)
    return null
  }
}

/** Wait for pending tile loads and camera motion before taking a layout snapshot. */
export async function captureMapSnapshotAfterIdle(timeoutMs = 5000): Promise<string | null> {
  const map = mapEngine.getMap()
  if (!map) return null
  await new Promise<void>((resolve) => {
    let timer: ReturnType<typeof setTimeout>
    const finish = () => {
      map.off('idle', finish)
      clearTimeout(timer)
      resolve()
    }
    map.once('idle', finish)
    timer = setTimeout(finish, timeoutMs)
    map.triggerRepaint()
  })
  return captureCurrentMapSnapshot()
}
