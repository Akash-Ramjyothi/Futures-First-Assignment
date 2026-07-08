// Backend entry point: wires together generator, aggregator, HTTP, and WebSocket layers

import express from 'express';
import cors from 'cors';
import http from 'http';
import { createWSServer, broadcastCandle } from './wsServer';
import { generateCandle, generateHistory, getAvailableSymbols } from './generator';
import { aggregateToInterval, Interval, updateAggregatedCandle, getCachedAggregated, setCachedAggregated } from './aggregator';


const HTTP_PORT = Number(process.env.HTTP_PORT) || 4000;
const WS_PORT = Number(process.env.WS_PORT) || 4001;
const SYMBOLS = getAvailableSymbols();
const INTERVALS: Interval[] = ['1m', '5m', '15m', '1h', '1d'];

// In-memory state
const oneMinuteHistory: Map<string, any[]> = new Map(); // symbol -> 1m candles
const aggregatedState: Map<string, Map<Interval, any[]>> = new Map(); // symbol -> interval -> candles
const currentAggregated: Map<string, Map<Interval, any | null>> = new Map(); // symbol -> interval -> current candle

// Initialize state containers
function bootstrapState() {
    SYMBOLS.forEach((symbol) => {
        oneMinuteHistory.set(symbol, []);
        aggregatedState.set(symbol, new Map());
        currentAggregated.set(symbol, new Map());

        INTERVALS.forEach((interval) => {
            aggregatedState.get(symbol)!.set(interval, []);
            currentAggregated.get(symbol)!.set(interval, null);
        });
    });
}

// Append candle to a bounded history (keeps last 500)
function pushToHistory(list: any[], candle: any, limit = 500) {
    list.push(candle);
    if (list.length > limit) {
        list.shift();
    }
}

// Generate initial history so charts render instantly
function seedHistory() {
    const now = Date.now();
    SYMBOLS.forEach((symbol) => {
        const history = generateHistory(symbol, 500, now);
        oneMinuteHistory.set(symbol, history);

        INTERVALS.forEach((interval) => {
            const aggregated = aggregateToInterval(history, interval);
            aggregatedState.get(symbol)!.set(interval, aggregated);

            const recent = aggregated[aggregated.length - 1] ?? null;
            currentAggregated.get(symbol)!.set(interval, recent);
        });
    });
}

// Main scheduler: ticks every second (accelerated 60x vs real minute)
function startGeneratorLoop() {
    setInterval(() => {
        const timestamp = Date.now();

        SYMBOLS.forEach((symbol) => {
            const oneMinuteCandle = generateCandle(symbol, timestamp);
            pushToHistory(oneMinuteHistory.get(symbol)!, oneMinuteCandle);

            INTERVALS.forEach((interval) => {
                const current = currentAggregated.get(symbol)!.get(interval) ?? null;
                const updated = updateAggregatedCandle(current, oneMinuteCandle, interval);

                currentAggregated.get(symbol)!.set(interval, updated);

                // Cache the aggregated candle
                setCachedAggregated(symbol, interval, updated);

                // If the bucket just closed (i.e., new candle for interval), broadcast and store it
                const intervalMs = getIntervalDurationMs(interval);
                if ((timestamp - updated.timestamp) >= intervalMs - 1000) {
                    pushToHistory(aggregatedState.get(symbol)!.get(interval)!, updated);
                    broadcastCandle(symbol, interval, updated);
                    currentAggregated.get(symbol)!.set(interval, null);
                }

                // Always broadcast the 1m candle immediately
                if (interval === '1m') {
                    broadcastCandle(symbol, '1m', oneMinuteCandle);
                }
            });
        });
    }, 1000);
}

// Express server setup
function createHttpServer() {
    const app = express();
    app.use(cors());
    const server = http.createServer(app);

    app.get('/health', (_req, res) => {
        res.json({ status: 'ok', symbols: SYMBOLS.length, intervals: INTERVALS.length });
    });

    app.get('/history', (req, res) => {
        const symbol = String(req.query.symbol || '').toUpperCase();
        const interval = req.query.interval as Interval;
        const limit = Math.min(Number(req.query.limit) || 200, 5000);
        const from = req.query.from ? Number(req.query.from) : undefined;
        const to = req.query.to ? Number(req.query.to) : undefined;

        if (!SYMBOLS.includes(symbol)) {
            return res.status(400).json({ error: `Unknown symbol: ${symbol}` });
        }
        if (!INTERVALS.includes(interval)) {
            return res.status(400).json({ error: `Unsupported interval: ${interval}` });
        }

        let data: any[];

        // If time range is specified, generate historical data on-demand
        if (from !== undefined || to !== undefined) {
            const endTime = to ?? Date.now();
            const startTime = from ?? (endTime - (24 * 60 * 60 * 1000));
            const durationMs = endTime - startTime;
            const oneMinuteCount = Math.floor(durationMs / (60 * 1000));
            
            const oneMinuteHistory = generateHistory(symbol, Math.min(oneMinuteCount, 100000), endTime);
            
            if (interval === '1m') {
                data = oneMinuteHistory;
            } else {
                data = aggregateToInterval(oneMinuteHistory, interval);
            }
            
            data.sort((a, b) => b.timestamp - a.timestamp);
            data = data.slice(0, limit);
        } else {
            const stored = aggregatedState.get(symbol)!.get(interval) ?? [];
            const sliced = stored.slice(-limit);
            data = sliced;
        }

        res.json({ symbol, interval, data });
    });

    server.listen(HTTP_PORT, () => {
        console.log(`[HTTP] Server listening on port ${HTTP_PORT}`);
    });

    return server;
}

// Helper: interval duration in ms
function getIntervalDurationMs(interval: Interval): number {
    switch (interval) {
        case '1m': return 60 * 1000;
        case '5m': return 5 * 60 * 1000;
        case '15m': return 15 * 60 * 1000;
        case '1h': return 60 * 60 * 1000;
        case '1d': return 24 * 60 * 60 * 1000;
        default: return 60 * 1000;
    }
}

// Graceful shutdown
function setupShutdown(server: http.Server, wss: any) {
    const shutdown = () => {
        console.log('[SYS] Shutting down...');
        wss.clients.forEach((client: any) => client.terminate());
        wss.close();
        server.close(() => {
            console.log('[SYS] HTTP server closed');
            process.exit(0);
        });
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
}

// Bootstrap everything
function main() {
    bootstrapState();
    seedHistory();
    startGeneratorLoop();

    const server = createHttpServer();
    const wss = createWSServer(WS_PORT);
    setupShutdown(server, wss);
}

main();