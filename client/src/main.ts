import './style.css'
import { ChartTile } from './modules/chartManager'
import { loadWorkspace, saveWorkspace, resetWorkspace, getDefaultWorkspace, type WorkspaceState, type ChartSlotState, type LayoutId, type IntervalId } from './modules/workspace'

const root = document.querySelector<HTMLDivElement>('#app')

if (!root) {
  throw new Error('Mount point #app not found')
}

const SYMBOL_POOL = ['BTC', 'ETH', 'SOL', 'AAPL', 'TSLA', 'MSFT', 'META']
const INTERVAL_OPTIONS: IntervalId[] = ['1m', '5m', '15m', '1h', '1d']

let workspace: WorkspaceState = loadWorkspace()
const tiles = new Map<string, ChartTile>()

function createShell () {
  root.innerHTML = `
    <div class="shell">
      <header class="shell__header">
        <div class="brand">
          <div class="brand__accent"></div>
          <div>
            <p class="brand__eyebrow">PulseGrid Lab</p>
            <h1>Live Market Workbench</h1>
          </div>
        </div>
        <div class="header__stats">
          <div>
            <p>Active Symbols</p>
            <strong>${workspace.slots.length}</strong>
          </div>
          <div>
            <p>Layout</p>
            <strong class="js-current-layout">${workspace.layoutId === 'grid' ? '2x2 Grid' : 'Single'}</strong>
          </div>
        </div>
      </header>

      <section class="control-panel">
        <div class="control-panel__group">
          <label>Layout</label>
          <div class="layout-toggle">
            <button class="layout-btn" data-layout="single">Solo</button>
            <button class="layout-btn" data-layout="grid">Grid</button>
          </div>
        </div>
        <div class="control-panel__group">
          <label>Workspace</label>
          <div class="workspace-actions">
            <button data-action="save">Save workspace</button>
            <button data-action="reset">Reset</button>
          </div>
        </div>
      </section>

      <section class="grid" data-layout="${workspace.layoutId}"></section>
    </div>
  `
}

function ensureSlotsForLayout (state: WorkspaceState): ChartSlotState[] {
  if (state.layoutId === 'single') {
    return [state.slots[0] ?? getDefaultWorkspace().slots[0]]
  }
  const current = [...state.slots]
  while (current.length < 4) {
    const fallback = getDefaultWorkspace().slots[current.length]
    current.push({ ...fallback, id: `slot-${current.length + 1}` })
  }
  return current.slice(0, 4)
}

function renderGrid () {
  const grid = root.querySelector<HTMLDivElement>('.grid')
  const layoutLabel = root.querySelector<HTMLElement>('.js-current-layout')
  if (!grid || !layoutLabel) return

  layoutLabel.textContent = workspace.layoutId === 'grid' ? '2x2 Grid' : 'Single'
  grid.dataset.layout = workspace.layoutId

  tiles.forEach(tile => tile.destroy())
  tiles.clear()

  const slots = ensureSlotsForLayout(workspace)
  grid.innerHTML = slots.map(slot => buildCard(slot)).join('')

  slots.forEach(slot => {
    const card = grid.querySelector<HTMLDivElement>(`[data-slot="${slot.id}"]`)
    if (!card) return
    hydrateCard(card, slot)
  })
}

function buildCard (slot: ChartSlotState) {
  const intervalButtons = INTERVAL_OPTIONS.map(interval => `
    <button data-interval="${interval}" class="interval-btn ${interval === slot.interval ? 'is-active' : ''}">${interval}</button>
  `).join('')

  const symbolOptions = SYMBOL_POOL.map(symbol => `<option value="${symbol}"></option>`).join('')

  return `
    <article class="chart-card" data-slot="${slot.id}">
      <div class="chart-card__header">
        <div>
          <label>Symbol</label>
          <input class="symbol-input" list="symbol-list-${slot.id}" value="${slot.symbol}" spellcheck="false" />
          <datalist id="symbol-list-${slot.id}">${symbolOptions}</datalist>
        </div>
        <div>
          <div class="interval-group">
            ${intervalButtons}
          </div>
          <div class="axis-chips">
            <span class="axis-chip">X: Time</span>
            <span class="axis-chip">Y: Price</span>
          </div>
        </div>
      </div>
      <div class="card-metrics" aria-live="polite">
        ${['time', 'open', 'high', 'low', 'close', 'volume'].map(metric => `
          <div>
            <p>${metric.charAt(0).toUpperCase() + metric.slice(1)}</p>
            <strong data-slot-metric="${slot.id}-${metric}">--</strong>
          </div>
        `).join('')}
      </div>
      <div class="chart-card__canvas-container">
        <div class="chart-card__canvas"></div>
      </div>
      <footer class="chart-card__footer">
        <div class="status" data-status="idle">Awaiting data</div>
      </footer>
    </article>
  `
}

function hydrateCard (card: HTMLElement, slot: ChartSlotState) {
  const canvas = card.querySelector<HTMLElement>('.chart-card__canvas')
  const statusEl = card.querySelector<HTMLElement>('.status')
  const symbolInput = card.querySelector<HTMLInputElement>('.symbol-input')
  const intervalButtons = card.querySelectorAll<HTMLButtonElement>('.interval-btn')
  const metricEls = card.querySelectorAll<HTMLElement>('[data-slot-metric]')

  if (!canvas || !statusEl || !symbolInput) return

  const tile = new ChartTile({
    chartDom: canvas,
    onStatus: (state, message) => {
      statusEl.dataset.status = state
      statusEl.textContent = message ?? (state === 'ready' ? 'Live' : state)
    },
    onMetrics: metrics => updateCardMetrics(metricEls, metrics)
  }, slot.symbol, slot.interval)

  tiles.set(slot.id, tile)

  symbolInput.addEventListener('change', () => {
    const value = symbolInput.value.trim().toUpperCase()
    if (!value) return
    updateSlot(slot.id, { symbol: value })
  })

  intervalButtons.forEach(button => {
    button.addEventListener('click', () => {
      const newInterval = button.dataset.interval as IntervalId
      updateSlot(slot.id, { interval: newInterval })
    })
  })

}

function updateSlot (slotId: string, changes: Partial<ChartSlotState>) {
  workspace = {
    ...workspace,
    slots: workspace.slots.map(slot => slot.id === slotId ? { ...slot, ...changes } : slot)
  }
  saveWorkspace(workspace)
  renderGrid()
}

function updateCardMetrics (nodes: NodeListOf<HTMLElement>, metrics: ChartMetrics) {
  nodes.forEach(node => {
    const metricKey = node.dataset.slotMetric?.split('-').pop() as keyof ChartMetrics | undefined
    if (metricKey && metrics[metricKey] !== undefined) {
      node.textContent = metrics[metricKey]
    }
  })
}

function attachLayoutHandlers () {
  root.querySelectorAll<HTMLButtonElement>('.layout-btn').forEach(button => {
    button.addEventListener('click', () => {
      const layout = button.dataset.layout as LayoutId
      if (!layout || layout === workspace.layoutId) return
      workspace = {
        ...workspace,
        layoutId: layout
      }
      saveWorkspace(workspace)
      renderGrid()
    })
  })

  root.querySelectorAll<HTMLButtonElement>('.workspace-actions button').forEach(button => {
    button.addEventListener('click', () => {
      const action = button.dataset.action
      if (action === 'save') {
        saveWorkspace(workspace)
        button.textContent = 'Saved ✓'
        setTimeout(() => { button.textContent = 'Save workspace' }, 1500)
      }
      if (action === 'reset') {
        workspace = resetWorkspace()
        renderGrid()
      }
    })
  })
}

createShell()
renderGrid()
attachLayoutHandlers()
