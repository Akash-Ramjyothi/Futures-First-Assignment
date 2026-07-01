#!/usr/bin/env node
/*
 * Lightweight WebSocket load generator for PulseGrid backend.
 * Spawns N clients, subscribes each to a symbol/interval, and records
 * connection time plus inter-message intervals.
 */

const { WebSocket } = require('ws')

const argv = process.argv.slice(2)
const arg = (name, fallback) => {
  const idx = argv.indexOf(`--${name}`)
  if (idx !== -1 && idx + 1 < argv.length) {
    return argv[idx + 1]
  }
  return fallback
}

const clientsTarget = Number(arg('clients', 1000))
const durationMs = Number(arg('duration', 15000))
const intervalMs = Number(arg('interval', 1000))
const symbol = arg('symbol', 'BTC')
const interval = arg('frame', '1m')
const host = arg('host', 'ws://localhost:4001')

console.log('\n[loadtest] starting', {
  clientsTarget,
  durationMs,
  intervalMs,
  symbol,
  interval,
  host
})

const clients = []
const connectTimes = []
const messageIntervals = []
let messageCount = 0
const lastMessageMap = new WeakMap()
let closed = false

const shutdown = reason => {
  if (closed) return
  closed = true
  clients.forEach(ws => {
    try { ws.close() } catch {}
  })
  const avg = arr => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0
  const toMs = value => `${value.toFixed(2)} ms`
  console.log('\n[loadtest] complete:', reason)
  console.log('  connected clients  ', connectTimes.length)
  console.log('  avg connect time   ', toMs(avg(connectTimes)))
  console.log('  avg msg interval   ', toMs(avg(messageIntervals)))
  console.log('  total messages     ', messageCount)
  console.log('  test duration      ', durationMs / 1000, 's')
  process.exit(0)
}

process.on('SIGINT', () => shutdown('SIGINT'))

for (let i = 0; i < clientsTarget; i += 1) {
  const ws = new WebSocket(host)
  clients.push(ws)
  const connectStart = Date.now()

  ws.on('open', () => {
    connectTimes.push(Date.now() - connectStart)
    ws.send(JSON.stringify({ action: 'subscribe', symbol, interval }))
    // throttle additional subscription churn to emulate real load
    const heartbeat = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ action: 'subscribe', symbol, interval }))
      } else {
        clearInterval(heartbeat)
      }
    }, intervalMs)
  })

  ws.on('message', () => {
    const now = Date.now()
    const last = lastMessageMap.get(ws)
    if (last) {
      messageIntervals.push(now - last)
    }
    lastMessageMap.set(ws, now)
    messageCount += 1
  })

  ws.on('error', err => {
    console.error('[loadtest] client error', err.message)
  })
}

setTimeout(() => shutdown('duration reached'), durationMs)
