export interface Candle {
    timestamp: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
}

export interface GeneratorState {
    lastPrice: number;
    volatility: number;
    trend: number;
}

const MINUTE_MS = 60 * 1000;

const SYMBOL_CONFIGS: Record<string, { basePrice: number; volatility: number }> = {
    BTC: { basePrice: 68000, volatility: 0.0035 },
    ETH: { basePrice: 3500, volatility: 0.0042 },
    SOL: { basePrice: 145, volatility: 0.0055 },
    AAPL: { basePrice: 175, volatility: 0.0018 },
    TSLA: { basePrice: 245, volatility: 0.0038 },
}

const generatorStates: Map<string, GeneratorState> = new Map();


// Initialize generator state for a symbol
export function initializeSymbol(symbol: string): void {
    if (generatorStates.has(symbol))
        return;

    const config = SYMBOL_CONFIGS[symbol] || { basePrice: 100, volatility: 0.003 };
    generatorStates.set(symbol, {
        lastPrice: config.basePrice,
        volatility: config.volatility,
        trend: 0,
    });
}

// Generate next 1-minute candle with volatility
// Formula: New Price = Old Price × (1 + Trend + Random_Shock × Volatility + News_Event)
export function generateCandle(symbol: string, timestamp: number): Candle {
    let state = generatorStates.get(symbol);

    // Fallback: initialize if not exists
    if (!state) {
        initializeSymbol(symbol);
        state = generatorStates.get(symbol)!;
    }

    // Bound volatality to be realistic
    state.volatility = Math.max(0.001, Math.min(state.volatility, 0.03));

    // Bound trend to be realistic
    state.trend = Math.max(-0.004, Math.min(state.trend, 0.004));

    // Random walk
    const randomShock = (Math.random() - 0.5) * 2; // -1 to 1
    const newsEvent = Math.random() < 0.05 ? (Math.random() - 0.5) * 0.02 : 0; // 5% chance of news

    // Calculate price change
    const priceChange = state.trend + (randomShock * state.volatility) + newsEvent;
    const open = state.lastPrice;
    const close = Math.max(1, open * (1 + priceChange)); // Never go below 1

    // Generate high/low with wicks
    const wickSize = state.volatility * (0.2 + Math.random() * 0.8);
    const high = Math.max(open, close) * (1 + wickSize * 0.5);
    const low = Math.min(open, close) * (1 - wickSize * 0.5);

    // Volume correlates with price movement
    const priceRange = (high - low) / open;
    const baseVolume = 1000 + open * 0.5;
    const volume = Math.round(baseVolume * (1 + priceRange * 50) * (0.5 + Math.random()));

    // Update state for next iteration
    state.trend = state.trend * 0.95 + (Math.random() - 0.5) * 0.001;
    state.volatility = state.volatility * 0.98 + Math.abs(randomShock) * 0.0005;
    state.lastPrice = close;

    return {
        timestamp,
        open: Number(open.toFixed(2)),
        high: Number(high.toFixed(2)),
        low: Number(low.toFixed(2)),
        close: Number(close.toFixed(2)),
        volume,
    };
}

// Generate historical candles for initial load
export function generateHistory(symbol: string, count: number, endTime: number): Candle[] {
    try {
        const candles: Candle[] = [];

        for (let i = count - 1; i >= 0; i--) {
            const timestamp = endTime - (i * MINUTE_MS);
            candles.push(generateCandle(symbol, timestamp));
        }

        return candles;
    } catch (error) {
        console.log(`Error generating history for ${symbol}: `, error);
        return [];
    }
}

// Get all avaialble symbols
export function getAvailableSymbols(): string[] {
    return Object.keys(SYMBOL_CONFIGS);
}

