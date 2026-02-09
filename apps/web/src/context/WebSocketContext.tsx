/**
 * WebSocket Context with exponential backoff reconnection
 */
import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import { config } from '../config/env';
import type { WebSocketMessage, OutgoingWebSocketMessage } from '../types/websocket-events';

interface WebSocketContextValue {
  isConnected: boolean;
  connectionStatus: 'connecting' | 'connected' | 'disconnected' | 'reconnecting';
  reconnectAttempt: number;
  lastMessage: WebSocketMessage | null;
  subscribe: (channel: string) => void;
  unsubscribe: (channel: string) => void;
  send: (message: OutgoingWebSocketMessage) => void;
}

const WebSocketContext = createContext<WebSocketContextValue | null>(null);

interface WebSocketProviderProps {
  children: React.ReactNode;
}

export function WebSocketProvider({ children }: WebSocketProviderProps) {
  const [isConnected, setIsConnected] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<WebSocketContextValue['connectionStatus']>('disconnected');
  const [reconnectAttempt, setReconnectAttempt] = useState(0);
  const [lastMessage, setLastMessage] = useState<WebSocketMessage | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const subscriptionsRef = useRef<Set<string>>(new Set());
  const reconnectTimeoutRef = useRef<number | null>(null);

  const connect = useCallback(() => {
    // Clean up existing connection
    if (wsRef.current) {
      wsRef.current.close();
    }

    setConnectionStatus('connecting');

    try {
      const ws = new WebSocket(config.wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        setIsConnected(true);
        setConnectionStatus('connected');
        setReconnectAttempt(0);

        // Re-subscribe to all channels
        subscriptionsRef.current.forEach((channel) => {
          ws.send(JSON.stringify({ type: 'subscribe', payload: { channel } }));
        });
      };

      ws.onclose = () => {
        setIsConnected(false);
        wsRef.current = null;

        // Don't reconnect if we've exceeded max attempts
        if (reconnectAttempt >= config.websocket.maxReconnectAttempts) {
          setConnectionStatus('disconnected');
          return;
        }

        setConnectionStatus('reconnecting');

        // Calculate delay with exponential backoff
        const delayIndex = Math.min(reconnectAttempt, config.websocket.reconnectDelays.length - 1);
        const delay = config.websocket.reconnectDelays[delayIndex];

        reconnectTimeoutRef.current = window.setTimeout(() => {
          setReconnectAttempt((prev) => prev + 1);
          connect();
        }, delay);
      };

      ws.onerror = () => {
        // Error will trigger onclose
        setIsConnected(false);
      };

      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data) as WebSocketMessage;
          setLastMessage(message);
        } catch {
          // Ignore malformed messages
        }
      };
    } catch {
      setConnectionStatus('disconnected');
    }
  }, [reconnectAttempt]);

  // Initial connection
  useEffect(() => {
    connect();

    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, []); // Only connect once on mount

  const subscribe = useCallback((channel: string) => {
    subscriptionsRef.current.add(channel);

    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'subscribe', payload: { channel } }));
    }
  }, []);

  const unsubscribe = useCallback((channel: string) => {
    subscriptionsRef.current.delete(channel);

    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'unsubscribe', payload: { channel } }));
    }
  }, []);

  const send = useCallback((message: OutgoingWebSocketMessage) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message));
    }
  }, []);

  const value: WebSocketContextValue = {
    isConnected,
    connectionStatus,
    reconnectAttempt,
    lastMessage,
    subscribe,
    unsubscribe,
    send,
  };

  return <WebSocketContext.Provider value={value}>{children}</WebSocketContext.Provider>;
}

/**
 * Hook to use WebSocket context
 */
export function useWebSocketContext() {
  const context = useContext(WebSocketContext);
  if (!context) {
    throw new Error('useWebSocketContext must be used within a WebSocketProvider');
  }
  return context;
}

// Alias for convenience
export const useWebSocket = useWebSocketContext;

/**
 * Hook to subscribe to a specific channel
 */
export function useWebSocketChannel(channel: string) {
  const { subscribe, unsubscribe, lastMessage } = useWebSocketContext();

  useEffect(() => {
    subscribe(channel);
    return () => unsubscribe(channel);
  }, [channel, subscribe, unsubscribe]);

  return lastMessage;
}
