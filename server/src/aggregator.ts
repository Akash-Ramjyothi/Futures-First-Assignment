// Aggregator: Derives higher timeframes from 1-minute data

import { Candle } from './generator.js';

export type Interval = '1m' | '5m' | '15m' | '1h' | '1d';

// Interval configurations (multiplier for 1-minute)
const INTERVAL_CONFIGS: Record<Interval, { minutes: number; label: string }> = {
    '1m': { minutes: 1, label: '1 minute' },
    '5m': { minutes: 5, label: '5 minutes' },
    '15m': { minutes: 15, label: '15 minutes' },
    '1h': { minutes: 60, label: '1 hour' },
    '1d': { minutes: 1440, label: '1 day' },
};

const MINUTE_MS = 60 * 1000;

//Get the bucket timestamp for a given candle timestamp and interval
function getBucketTimestamp(timestamp: number, interval: Interval): number {
    const config = INTERVAL_CONFIGS[interval];
    const intervalMs = config.minutes * MINUTE_MS;
    return Math.floor(timestamp / intervalMs) * intervalMs;
}

// Aggregate a list of 1-minute candles into a higher timeframe
export function aggregateToInterval(oneMinuteCandles: Candle[], interval: Interval): Candle[] {
    if (!oneMinuteCandles || oneMinuteCandles.length === 0) {
        return [];
    }

    // Sort by timestamp to ensure correct aggregation
    const sorted = [...oneMinuteCandles].sort((a, b) => a.timestamp - b.timestamp);

    // Group candles into buckets
    const buckets = new Map<number, Candle[]>();

    for (const candle of sorted) {
        const bucketTimestamp = getBucketTimestamp(candle.timestamp, interval);

        if (!buckets.has(bucketTimestamp)) {
            buckets.set(bucketTimestamp, []);
        }
        buckets.get(bucketTimestamp)!.push(candle);
    }

    // Aggregate each bucket into a single candle
    const aggregated: Candle[] = [];

    for (const [bucketTimestamp, candlesInBucket] of buckets) {
        if (candlesInBucket.length === 0) continue;

        const open = candlesInBucket[0].open; // First candle
        const close = candlesInBucket[candlesInBucket.length - 1].close; // Last candle
        const high = Math.max(...candlesInBucket.map(c => c.high)); // Maximum
        const low = Math.min(...candlesInBucket.map(c => c.low)); // Minimum
        const volume = candlesInBucket.reduce((sum, c) => sum + c.volume, 0); // Sum

        aggregated.push({
            timestamp: bucketTimestamp,
            open: Number(open.toFixed(2)),
            high: Number(high.toFixed(2)),
            low: Number(low.toFixed(2)),
            close: Number(close.toFixed(2)),
            volume,
        });
    }

    // Sort by timestamp
    return aggregated.sort((a, b) => a.timestamp - b.timestamp);
}

// Incrementally update a higher timeframe candle with a new 1-minute candle
export function updateAggregatedCandle(
    currentAggregated: Candle | null,
    newOneMinute: Candle,
    interval: Interval
): Candle {
    const bucketTimestamp = getBucketTimestamp(newOneMinute.timestamp, interval);

    // If this is a new bucket, start fresh
    if (!currentAggregated || currentAggregated.timestamp !== bucketTimestamp) {
        return {
            timestamp: bucketTimestamp,
            open: newOneMinute.open,
            high: newOneMinute.high,
            low: newOneMinute.low,
            close: newOneMinute.close,
            volume: newOneMinute.volume,
        };
    }

    // Otherwise, update the existing candle
    return {
        timestamp: bucketTimestamp,
        open: currentAggregated.open, // Open stays the same (first candle)
        high: Math.max(currentAggregated.high, newOneMinute.high), // Update high
        low: Math.min(currentAggregated.low, newOneMinute.low), // Update low
        close: newOneMinute.close, // Close becomes latest candle
        volume: currentAggregated.volume + newOneMinute.volume, // Sum volume
    };
}

// Get all supported intervals
export function getSupportedIntervals(): Interval[] {
    return Object.keys(INTERVAL_CONFIGS) as Interval[];
}