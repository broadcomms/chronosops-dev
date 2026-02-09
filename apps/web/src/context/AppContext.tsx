/**
 * App Context for global application state
 */
import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { config } from '../config/env';
import { checkAllConnections } from '../api/health';
import type { ConnectionStatus } from '../types';

interface AppContextValue {
  // Active incident tracking
  activeIncidentId: string | null;
  setActiveIncidentId: (id: string | null) => void;

  // Demo mode
  demoMode: boolean;

  // Connection status
  connectionStatus: ConnectionStatus;
  refreshConnectionStatus: () => Promise<void>;

  // UI state
  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
}

const AppContext = createContext<AppContextValue | null>(null);

interface AppProviderProps {
  children: React.ReactNode;
}

export function AppProvider({ children }: AppProviderProps) {
  const [activeIncidentId, setActiveIncidentId] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>({
    api: 'disconnected',
    websocket: 'disconnected',
    vision: 'disconnected',
    kubernetes: 'disconnected',
  });

  const demoMode = config.features.demoMode;

  const refreshConnectionStatus = useCallback(async () => {
    const status = await checkAllConnections();
    setConnectionStatus(status);
  }, []);

  // Poll connection status
  useEffect(() => {
    refreshConnectionStatus();

    const interval = setInterval(refreshConnectionStatus, config.polling.healthInterval);
    return () => clearInterval(interval);
  }, [refreshConnectionStatus]);

  const value: AppContextValue = {
    activeIncidentId,
    setActiveIncidentId,
    demoMode,
    connectionStatus,
    refreshConnectionStatus,
    sidebarOpen,
    setSidebarOpen,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

/**
 * Hook to use App context
 */
export function useAppContext() {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useAppContext must be used within an AppProvider');
  }
  return context;
}

/**
 * Hook to get connection status
 */
export function useConnectionStatus() {
  const { connectionStatus, refreshConnectionStatus } = useAppContext();
  return { status: connectionStatus, refresh: refreshConnectionStatus };
}

/**
 * Hook to track active incident
 */
export function useActiveIncident() {
  const { activeIncidentId, setActiveIncidentId } = useAppContext();
  return { activeIncidentId, setActiveIncidentId };
}
