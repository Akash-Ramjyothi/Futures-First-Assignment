// WebSocket Server: Pub/Sub for real-time candle data
import { WebSocket, WebSocketServer } from 'ws';
import { Interval } from './aggregator.js';

// Topic format: "BTC:1m", "ETH:5m", etc.
type Topic = `${string}:${Interval}`;

// Client subscription state
interface ClientState {
    ws: WebSocket;
    subscriptions: Set<Topic>;
    isAlive: boolean;
}

// Pub/Sub state
const clients = new Map<WebSocket, ClientState>();
const topicSubscribers = new Map<Topic, Set<WebSocket>>();

// Initialize WebSocket server
export function createWSServer(port: number): WebSocketServer {
    const wss = new WebSocketServer({ port });

    wss.on('connection', (ws: WebSocket) => {
        console.log(`[WS] Client connected. Total clients: ${clients.size + 1}`);

        // Initialize client state
        const clientState: ClientState = {
            ws,
            subscriptions: new Set(),
            isAlive: true,
        };
        clients.set(ws, clientState);

        // Send welcome message
        sendToClient(ws, { type: 'connected', message: 'Connected to chart server' });

        // Handle incoming messages
        ws.on('message', (data: Buffer) => {
            try {
                const message = JSON.parse(data.toString());
                handleMessage(ws, clientState, message);
            } catch (error) {
                console.error('[WS] Error parsing message:', error);
                sendError(ws, 'Invalid message format');
            }
        });

        // Handle ping/pong for connection health
        ws.on('pong', () => {
            clientState.isAlive = true;
        });

        // Handle disconnection
        ws.on('close', () => {
            handleDisconnect(ws);
        });

        // Handle errors
        ws.on('error', (error) => {
            console.error('[WS] WebSocket error:', error);
            handleDisconnect(ws);
        });
    });

    // Periodic health check (detect dead connections)
    const interval = setInterval(() => {
        wss.clients.forEach((ws) => {
            const clientState = clients.get(ws);
            if (!clientState || !clientState.isAlive) {
                console.log('[WS] Terminating dead connection');
                ws.terminate();
                if (clientState) handleDisconnect(ws);
            } else {
                clientState.isAlive = false;
                ws.ping();
            }
        });
    }, 30000); // 30 seconds

    wss.on('close', () => {
        clearInterval(interval);
    });

    console.log(`[WS] WebSocket server listening on port ${port}`);
    return wss;
}

// Handle incoming client messages
function handleMessage(ws: WebSocket, clientState: ClientState, message: any): void {
    switch (message.action) {
        case 'subscribe':
            handleSubscribe(ws, clientState, message.symbol, message.interval);
            break;
        case 'unsubscribe':
            handleUnsubscribe(ws, clientState, message.symbol, message.interval);
            break;
        case 'history':
            // This is handled by the HTTP endpoint, not WebSocket
            sendError(ws, 'Use HTTP endpoint for history requests');
            break;
        default:
            sendError(ws, `Unknown action: ${message.action}`);
    }
}


// Handle subscription request
function handleSubscribe(ws: WebSocket, clientState: ClientState, symbol: string, interval: Interval): void {
    if (!symbol || !interval) {
        sendError(ws, 'Missing symbol or interval');
        return;
    }

    const topic: Topic = `${symbol}:${interval}`;

    // Add to client's subscriptions
    clientState.subscriptions.add(topic);

    // Add to topic's subscribers
    if (!topicSubscribers.has(topic)) {
        topicSubscribers.set(topic, new Set());
    }
    topicSubscribers.get(topic)!.add(ws);

    console.log(`[WS] Client subscribed to ${topic}. Total subscribers: ${topicSubscribers.get(topic)!.size}`);

    // Send confirmation
    sendToClient(ws, { type: 'subscribed', symbol, interval });
}


// Handle unsubscription request
function handleUnsubscribe(ws: WebSocket, clientState: ClientState, symbol: string, interval: Interval): void {
    const topic: Topic = `${symbol}:${interval}`;

    // Remove from client's subscriptions
    clientState.subscriptions.delete(topic);

    // Remove from topic's subscribers
    const subscribers = topicSubscribers.get(topic);
    if (subscribers) {
        subscribers.delete(ws);
        if (subscribers.size === 0) {
            topicSubscribers.delete(topic); // Clean up empty topics
        }
    }

    console.log(`[WS] Client unsubscribed from ${topic}`);

    // Send confirmation
    sendToClient(ws, { type: 'unsubscribed', symbol, interval });
}


// Handle client disconnection
function handleDisconnect(ws: WebSocket): void {
    const clientState = clients.get(ws);
    if (!clientState) return;

    console.log(`[WS] Client disconnected. Total clients: ${clients.size - 1}`);

    // Remove client from all topic subscriptions
    for (const topic of clientState.subscriptions) {
        const subscribers = topicSubscribers.get(topic);
        if (subscribers) {
            subscribers.delete(ws);
            if (subscribers.size === 0) {
                topicSubscribers.delete(topic);
            }
        }
    }

    // Remove client
    clients.delete(ws);
}

// Broadcast a candle update to all subscribers of a topic
export function broadcastCandle(symbol: string, interval: Interval, candle: any): void {
    const topic: Topic = `${symbol}:${interval}`;
    const subscribers = topicSubscribers.get(topic);

    if (!subscribers || subscribers.size === 0) {
        return; // No subscribers for this topic
    }

    const message = {
        type: 'candle',
        symbol,
        interval,
        data: candle,
    };

    const messageStr = JSON.stringify(message);

    // Send to all subscribers
    let successCount = 0;
    for (const ws of subscribers) {
        try {
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(messageStr);
                successCount++;
            }
        } catch (error) {
            console.error(`[WS] Error sending to client:`, error);
        }
    }

    console.log(`[WS] Broadcasted ${topic} to ${successCount}/${subscribers.size} clients`);
}


// Send message to a specific client
function sendToClient(ws: WebSocket, message: any): void {
    try {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(message));
        }
    } catch (error) {
        console.error('[WS] Error sending to client:', error);
    }
}


// Send error to client
function sendError(ws: WebSocket, error: string): void {
    sendToClient(ws, { type: 'error', error });
}


// Get current connection stats (for monitoring)
export function getConnectionStats(): { totalClients: number; topicCount: number } {
    return {
        totalClients: clients.size,
        topicCount: topicSubscribers.size,
    };
}