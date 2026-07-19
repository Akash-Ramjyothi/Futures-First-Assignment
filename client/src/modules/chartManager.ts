import { init, dispose, type KLineChart, type KLineData } from '../../../src/index'
import type { DataLoader } from '../../../src/common/DataLoader'
import type { Period } from '../../../src/common/Period'
import type { SymbolInfo } from '../../../src/common/SymbolInfo'
import { wsClient } from './wsClient'
import type { IntervalId } from './workspace'

export interface ChartMetrics {
  time: string
  open: string
  high: string
  low: string
  close: string
  volume: string
}

interface ChartDependencies {
  chartDom: HTMLElement
  onStatus?: (status: 'loading' | 'ready' | 'error', message?: string) => void
  onMetrics?: (metrics: ChartMetrics) => void
}

const HTTP_BASE = `${location.protocol}//${location.hostname}:4000`

const PERIOD_MAP: Record<IntervalId, { span: number, type: 'minute' | 'hour' | 'day' }> = {
  '1m': { span: 1, type: 'minute' },
  '5m': { span: 5, type: 'minute' },
  '15m': { span: 15, type: 'minute' },
  '1h': { span: 1, type: 'hour' },
  '1d': { span: 1, type: 'day' }
}

export class ChartTile {
  private chart: KLineChart | null = null
  private symbol: string
  private interval: IntervalId
  private dateRangeDays = 1
  private readonly wsHandlers = new Map<string, (payload: any) => void>()

  constructor (private readonly deps: ChartDependencies, initialSymbol: string, initialInterval: IntervalId) {
    this.symbol = initialSymbol
    this.interval = initialInterval
    this.mount()
  }

  private mount () {
    this.chart = init(this.deps.chartDom, {
      layout: {
        background: '#f8f9fc',
        candle: {
          bar: {
            upColor: '#18a999',
            downColor: '#e85464',
            upBorderColor: '#149d90',
            downBorderColor: '#d14958'
          }
        },
        text: { color: '#0f172a' }
      },
      grid: {
        horizontal: { color: 'rgba(15,23,42,0.08)', style: 'dashed' },
        vertical: { color: 'rgba(15,23,42,0.08)', style: 'dashed' }
      }
    })
    this.chart?.setSymbol(this.createSymbolInfo(this.symbol))
    this.chart?.setPeriod(PERIOD_MAP[this.interval])
    this.chart?.setDataLoader(this.createDataLoader())
  }

  async sync (symbol = this.symbol, interval: IntervalId = this.interval) {
    this.symbol = symbol.toUpperCase()
    this.interval = interval
    this.deps.onStatus?.('loading', 'Refreshing workspace')
    this.chart?.setSymbol(this.createSymbolInfo(this.symbol))
    this.chart?.setPeriod(PERIOD_MAP[this.interval])
    this.chart?.resetData()
  }

  setDateRange (days: number) {
    this.dateRangeDays = days
    this.chart?.resetData()
  }

  private async fetchHistory (symbol: string, interval: IntervalId): Promise<KLineData[]> {
    const params = new URLSearchParams({ symbol, interval, limit: '2000' })
    
    // Add date range if more than 1 day
    if (this.dateRangeDays > 1) {
      const to = Date.now()
      const from = to - (this.dateRangeDays * 24 * 60 * 60 * 1000)
      params.append('from', from.toString())
      params.append('to', to.toString())
    }
    
    console.log('[chartTile] request', `${HTTP_BASE}/history?${params.toString()}`)
    const response = await fetch(`${HTTP_BASE}/history?${params.toString()}`)
    if (!response.ok) {
      throw new Error(`History request failed with ${response.status}`)
    }
    const payload = await response.json()
    console.log('[chartTile] payload sample', payload.data?.[0])
    return payload.data ?? []
  }

  private createDataLoader (): DataLoader {
    return {
      getBars: async ({ type, symbol, period, callback }) => {
        const interval = this.intervalFromPeriod(period)
        if (!interval) {
          callback([], { forward: false, backward: false })
          return
        }
        if (type !== 'init') {
          callback([], { forward: false, backward: false })
          return
        }
        this.deps.onStatus?.('loading', `Loading ${symbol.ticker}/${interval}`)
        try {
          const history = await this.fetchHistory(symbol.ticker, interval)
          callback(history, { forward: false, backward: false })
          const last = history[history.length - 1]
          if (last) this.emitMetrics(last)
          this.deps.onStatus?.('ready', 'Live')
        } catch (error) {
          console.error('[chartTile] loader error', error)
          this.deps.onStatus?.('error', 'Unable to load data')
          callback([], { forward: false, backward: false })
        }
      },
      subscribeBar: ({ symbol, period, callback }) => {
        const interval = this.intervalFromPeriod(period)
        if (!interval) return
        const topic = this.topicKey(symbol.ticker, interval)
        const handler = ({ data, symbol: payloadSymbol, interval: payloadInterval }: any) => {
          if (payloadSymbol === symbol.ticker && payloadInterval === interval) {
            callback(data as KLineData)
            this.emitMetrics(data as KLineData)
          }
        }
        this.wsHandlers.set(topic, handler)
        wsClient.subscribe(symbol.ticker, interval, handler)
      },
      unsubscribeBar: ({ symbol, period }) => {
        const interval = this.intervalFromPeriod(period)
        if (!interval) return
        const topic = this.topicKey(symbol.ticker, interval)
        const handler = this.wsHandlers.get(topic)
        if (handler) {
          wsClient.unsubscribe(symbol.ticker, interval, handler)
          this.wsHandlers.delete(topic)
        }
      }
    }
  }

  private topicKey (symbol: string, interval: IntervalId) {
    return `${symbol}:${interval}`
  }

  private intervalFromPeriod (period: Period): IntervalId | null {
    if (period.type === 'minute') {
      if (period.span === 1) return '1m'
      if (period.span === 5) return '5m'
      if (period.span === 15) return '15m'
    }
    if (period.type === 'hour' && period.span === 1) return '1h'
    if (period.type === 'day' && period.span === 1) return '1d'
    return null
  }

  private createSymbolInfo (symbol: string): SymbolInfo {
    return { ticker: symbol, pricePrecision: 2, volumePrecision: 0 }
  }

  private emitMetrics (data: KLineData) {
    if (!this.deps.onMetrics) return
    const formatter = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 })
    const volumeFormatter = new Intl.NumberFormat('en-IN', { notation: 'compact', maximumFractionDigits: 2 })
    const formattedTime = new Intl.DateTimeFormat('en-GB', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit', hour12: false
    }).format(data.timestamp)

    this.deps.onMetrics({
      time: formattedTime.replace(',', ''),
      open: formatter.format(data.open),
      high: formatter.format(data.high),
      low: formatter.format(data.low),
      close: formatter.format(data.close),
      volume: volumeFormatter.format(data.volume)
    })
  }

  updateSymbol (symbol: string) {
    this.sync(symbol, this.interval)
  }

  updateInterval (interval: IntervalId) {
    this.sync(this.symbol, interval)
  }

  destroy () {
    this.wsHandlers.forEach((handler, topic) => {
      const [symbol, interval] = topic.split(':') as [string, IntervalId]
      wsClient.unsubscribe(symbol, interval, handler)
    })
    this.wsHandlers.clear()
    if (this.chart) {
      const dom = this.deps.chartDom
      dispose(dom)
      this.chart = null
    }
  }
}
