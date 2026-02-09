/**
 * WebSocket Handlers
 */

import type { FastifyInstance } from 'fastify';
import type { SocketStream } from '@fastify/websocket';
import type { WebSocket } from 'ws';
import { createChildLogger } from '@chronosops/shared';

const logger = createChildLogger({ component: 'WebSocket' });

// Store connected clients
const clients = new Set<WebSocket>();

// Store channel subscriptions: channel -> Set of clients
const subscriptions = new Map<string, Set<WebSocket>>();

export async function registerWebSocket(app: FastifyInstance): Promise<void> {
  app.get('/ws', { websocket: true }, (connection: SocketStream, req) => {
    const socket = connection.socket;
    logger.info('WebSocket client connected', { ip: req.ip });

    clients.add(socket);

    socket.on('message', (message) => {
      try {
        const data = JSON.parse(message.toString());
        handleMessage(socket, data);
      } catch (err) {
        logger.error('Invalid WebSocket message', err as Error);
      }
    });

    socket.on('close', () => {
      clients.delete(socket);
      // Clean up subscriptions
      for (const [channel, subs] of subscriptions.entries()) {
        subs.delete(socket);
        if (subs.size === 0) {
          subscriptions.delete(channel);
        }
      }
      logger.info('WebSocket client disconnected');
    });

    socket.on('error', (err) => {
      logger.error('WebSocket error', err);
      clients.delete(socket);
    });

    // Send welcome message
    socket.send(
      JSON.stringify({
        type: 'connected',
        timestamp: new Date().toISOString(),
      })
    );
  });
}

/**
 * Handle incoming WebSocket messages
 */
function handleMessage(socket: WebSocket, data: { type: string; payload?: unknown }): void {
  switch (data.type) {
    case 'ping':
      socket.send(JSON.stringify({ type: 'pong', timestamp: new Date().toISOString() }));
      break;

    case 'subscribe': {
      const payload = data.payload as { channel?: string } | undefined;
      const channel = payload?.channel;
      if (channel) {
        if (!subscriptions.has(channel)) {
          subscriptions.set(channel, new Set());
        }
        subscriptions.get(channel)!.add(socket);
        logger.info({ channel }, 'Client subscribed to channel');
        socket.send(JSON.stringify({ type: 'subscribed', channel, timestamp: new Date().toISOString() }));
      } else {
        socket.send(JSON.stringify({ type: 'error', message: 'Channel required for subscription' }));
      }
      break;
    }

    case 'unsubscribe': {
      const payload = data.payload as { channel?: string } | undefined;
      const channel = payload?.channel;
      if (channel && subscriptions.has(channel)) {
        subscriptions.get(channel)!.delete(socket);
        if (subscriptions.get(channel)!.size === 0) {
          subscriptions.delete(channel);
        }
        logger.info({ channel }, 'Client unsubscribed from channel');
        socket.send(JSON.stringify({ type: 'unsubscribed', channel, timestamp: new Date().toISOString() }));
      }
      break;
    }

    default:
      logger.warn({ type: data.type }, 'Unknown message type');
  }
}

/**
 * Broadcast message to all connected clients
 */
export function broadcast(message: { type: string; payload: unknown }): void {
  const data = JSON.stringify(message);

  for (const client of clients) {
    if (client.readyState === 1) {
      // OPEN
      client.send(data);
    }
  }
}

/**
 * Broadcast message to clients subscribed to a specific channel
 * Falls back to broadcast to all if no subscribers
 */
export function broadcastToChannel(channel: string, message: { type: string; payload: unknown }): void {
  const channelClients = subscriptions.get(channel);

  // If there are channel subscribers, send only to them
  if (channelClients && channelClients.size > 0) {
    const data = JSON.stringify(message);
    for (const client of channelClients) {
      if (client.readyState === 1) {
        client.send(data);
      }
    }
  } else {
    // No subscribers, broadcast to all
    broadcast(message);
  }
}

/**
 * Broadcast incident update
 */
export function broadcastIncidentUpdate(incidentId: string, update: unknown): void {
  const message = {
    type: 'incident:update',
    payload: { incidentId, update, timestamp: new Date().toISOString() },
  };
  // Send to incident channel subscribers, or broadcast to all
  broadcastToChannel(`incident:${incidentId}`, message);
}

/**
 * Broadcast phase change
 */
export function broadcastPhaseChange(incidentId: string, phase: string, context: unknown): void {
  const message = {
    type: 'phase:change',
    payload: { incidentId, phase, context, timestamp: new Date().toISOString() },
  };
  // Send to incident channel subscribers, or broadcast to all
  broadcastToChannel(`incident:${incidentId}`, message);
}

/**
 * Broadcast development cycle update
 */
export function broadcastDevelopmentCycleUpdate(cycleId: string, update: unknown): void {
  const message = {
    type: 'development:update',
    payload: { cycleId, update, timestamp: new Date().toISOString() },
  };
  // Send to development channel subscribers, or broadcast to all
  broadcastToChannel(`development:${cycleId}`, message);
}

/**
 * Broadcast development phase change
 */
export function broadcastDevelopmentPhaseChange(
  cycleId: string,
  phase: string,
  context: unknown
): void {
  const message = {
    type: 'development:phase',
    payload: { cycleId, phase, context, timestamp: new Date().toISOString() },
  };
  // Send to development channel subscribers, or broadcast to all
  broadcastToChannel(`development:${cycleId}`, message);
}

/**
 * Broadcast development cycle completion
 */
export function broadcastDevelopmentComplete(cycleId: string, result: unknown): void {
  const message = {
    type: 'development:complete',
    payload: { cycleId, result, timestamp: new Date().toISOString() },
  };
  // Send to development channel subscribers, or broadcast to all
  broadcastToChannel(`development:${cycleId}`, message);
}

/**
 * Broadcast development cycle failure
 */
export function broadcastDevelopmentFailed(cycleId: string, error: string, phase: string): void {
  const message = {
    type: 'development:failed',
    payload: { cycleId, error, phase, timestamp: new Date().toISOString() },
  };
  // Send to development channel subscribers, or broadcast to all
  broadcastToChannel(`development:${cycleId}`, message);
}

/**
 * Broadcast development cycle deletion
 */
export function broadcastDevelopmentDeleted(cycleId: string): void {
  const message = {
    type: 'development:deleted',
    payload: { cycleId, timestamp: new Date().toISOString() },
  };
  // Broadcast to all clients so they can update their lists
  broadcast(message);
}

/**
 * Broadcast pattern learned event (Intelligence Platform integration)
 */
export function broadcastPatternLearned(
  patternId: string,
  patternName: string,
  sourceIncidentId: string,
  patternsCount: number
): void {
  const message = {
    type: 'intelligence:pattern_learned',
    payload: {
      patternId,
      patternName,
      sourceIncidentId,
      patternsCount,
      timestamp: new Date().toISOString(),
    },
  };
  // Broadcast to all clients
  broadcast(message);
}

/**
 * Broadcast intelligence stats update
 */
export function broadcastIntelligenceStatsUpdate(stats: {
  totalPatterns: number;
  highConfidenceCount: number;
}): void {
  const message = {
    type: 'intelligence:stats_update',
    payload: {
      ...stats,
      timestamp: new Date().toISOString(),
    },
  };
  // Broadcast to all clients
  broadcast(message);
}
