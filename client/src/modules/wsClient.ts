import type { IntervalId } from './workspace'

type CandlePayload = {
  type: 'candle'
  symbol: string
  interval: IntervalId
  data: Record<string, unknown>
}

type CandleHandler = (payload: CandlePayload) => void

type Topic = `${string}:${IntervalId}`

const WS_URL = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.hostname}:4001`

class WebSocketClient {
  private socket: WebSocket | null = null
  private backoff = 1000
  private readonly maxBackoff = 10000
  private readonly subscribers = new Map<Topic, Set<CandleHandler>>()
  private readonly pendingMessages: string[] = []

  constructor (private readonly url: string) {
    this.connect()
  }

  private connect () {
    this.socket = new WebSocket(this.url)

    this.socket.addEventListener('open', () => {
      this.backoff = 1000
      this.flushPending()
      this.resubscribeAll()
    })

    this.socket.addEventListener('message', event => {
      try {
        const payload = JSON.parse(event.data)
        if (payload.type === 'candle') {
          this.dispatch(payload)
        }
      } catch (error) {
        console.error('[wsClient] failed to parse message', error)
      }
    })

    this.socket.addEventListener('close', () => {
      this.scheduleReconnect()
    })

    this.socket.addEventListener('error', error => {
      console.error('[wsClient] socket error', error)
      this.socket?.close()
    })
  }

  private scheduleReconnect () {
    setTimeout(() => {
      this.backoff = Math.min(this.backoff * 1.5, this.maxBackoff)
      this.connect()
    }, this.backoff)
  }

  private flushPending () {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return
    while (this.pendingMessages.length > 0) {
      const message = this.pendingMessages.shift()
      if (message) this.socket.send(message)
    }
  }

  private resubscribeAll () {
    for (const topic of this.subscribers.keys()) {
      const [symbol, interval] = topic.split(':') as [string, IntervalId]
      this.send({ action: 'subscribe', symbol, interval })
    }
  }

  private dispatch (payload: CandlePayload) {
    const topic: Topic = `${payload.symbol}:${payload.interval}`
    const handlers = this.subscribers.get(topic)
    if (!handlers) return
    handlers.forEach(handler => handler(payload))
  }

  private send (data: Record<string, unknown>) {
    const serialized = JSON.stringify(data)
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(serialized)
    } else {
      this.pendingMessages.push(serialized)
    }
  }

  subscribe (symbol: string, interval: IntervalId, handler: CandleHandler) {
    const topic: Topic = `${symbol}:${interval}`
    if (!this.subscribers.has(topic)) {
      this.subscribers.set(topic, new Set())
      this.send({ action: 'subscribe', symbol, interval })
    }
    this.subscribers.get(topic)!.add(handler)
  }

  unsubscribe (symbol: string, interval: IntervalId, handler?: CandleHandler) {
    const topic: Topic = `${symbol}:${interval}`
    const handlers = this.subscribers.get(topic)
    if (!handlers) return

    if (handler) {
      handlers.delete(handler)
    } else {
      handlers.clear()
    }

    if (handlers.size === 0) {
      this.subscribers.delete(topic)
      this.send({ action: 'unsubscribe', symbol, interval })
    }
  }
}

export const wsClient = new WebSocketClient(WS_URL)
