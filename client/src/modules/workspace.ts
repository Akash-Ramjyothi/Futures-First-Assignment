export type LayoutId = 'single' | 'grid'

export type IntervalId = '1m' | '5m' | '15m' | '1h' | '1d'

export interface ChartSlotState {
  id: string
  symbol: string
  interval: IntervalId
}

export interface WorkspaceState {
  layoutId: LayoutId
  slots: ChartSlotState[]
}

const STORAGE_KEY = 'pulsegrid-workspace'

const DEFAULT_WORKSPACE: WorkspaceState = {
  layoutId: 'grid',
  slots: [
    { id: 'slot-1', symbol: 'BTC', interval: '1m' },
    { id: 'slot-2', symbol: 'ETH', interval: '5m' },
    { id: 'slot-3', symbol: 'SOL', interval: '15m' },
    { id: 'slot-4', symbol: 'AAPL', interval: '1h' }
  ]
}

function isValidWorkspace (value: unknown): value is WorkspaceState {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Partial<WorkspaceState>
  if (candidate.layoutId !== 'single' && candidate.layoutId !== 'grid') return false
  if (!Array.isArray(candidate.slots)) return false
  return candidate.slots.every(slot => typeof slot?.id === 'string' && typeof slot.symbol === 'string')
}

export function loadWorkspace (): WorkspaceState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_WORKSPACE
    const parsed = JSON.parse(raw)
    if (isValidWorkspace(parsed)) {
      return {
        layoutId: parsed.layoutId,
        slots: parsed.slots.length > 0 ? parsed.slots : DEFAULT_WORKSPACE.slots
      }
    }
  } catch (error) {
    console.error('[workspace] unable to parse saved workspace', error)
  }
  return DEFAULT_WORKSPACE
}

export function saveWorkspace (state: WorkspaceState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch (error) {
    console.error('[workspace] unable to persist workspace', error)
  }
}

export function resetWorkspace (): WorkspaceState {
  localStorage.removeItem(STORAGE_KEY)
  return DEFAULT_WORKSPACE
}

export function getDefaultWorkspace (): WorkspaceState {
  return DEFAULT_WORKSPACE
}
