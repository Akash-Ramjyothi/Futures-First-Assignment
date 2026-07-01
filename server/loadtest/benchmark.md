# Load Test Benchmark

```
Command: node loadtest/loadtest.js --clients 200 --duration 10000 --interval 1000 --host ws://localhost:4101
Date: 2026-07-02

[loadtest] starting {
  clientsTarget: 200,
  durationMs: 10000,
  intervalMs: 1000,
  symbol: 'BTC',
  interval: '1m',
  host: 'ws://localhost:4101'
}

[loadtest] complete: duration reached
  connected clients   200
  avg connect time    79.19 ms
  avg msg interval    463.97 ms
  total messages      4200
  test duration       10 s
```
