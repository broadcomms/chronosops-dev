/**
 * Top navigation bar with connection status
 */
import { Link, useLocation } from 'react-router-dom';
import { Timer } from 'lucide-react';
import { useWebSocketContext } from '../../context/WebSocketContext';
import { useConnectionStatus } from '../../context/AppContext';
import type { ConnectionState } from '../../types';

interface NavItem {
  path: string;
  label: string;
}

const navItems: NavItem[] = [
  { path: '/', label: 'Command' },
  { path: '/incidents', label: 'Incidents' },
  { path: '/development', label: 'Development' },
  { path: '/intelligence', label: 'Intelligence' },
  { path: '/setup', label: 'Setup' },
  { path: '/history', label: 'History' },
];

function StatusDot({ status, label }: { status: ConnectionState; label: string }) {
  const colors: Record<ConnectionState, string> = {
    connected: 'bg-green-500',
    disconnected: 'bg-red-500',
    reconnecting: 'bg-yellow-500 animate-pulse',
    error: 'bg-red-500',
  };

  return (
    <div className="flex items-center gap-1.5">
      <span className={`h-2 w-2 rounded-full ${colors[status]}`} />
      <span className="text-xs text-gray-400">{label}</span>
    </div>
  );
}

export function Navigation() {
  const location = useLocation();
  const { connectionStatus: wsStatus } = useWebSocketContext();
  const { status } = useConnectionStatus();

  return (
    <header className="border-b border-gray-800 bg-gray-950">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
        {/* Logo and brand */}
        <div className="flex items-center gap-8">
          <Link to="/" className="flex items-center gap-3">
            <Timer size={28} className="text-blue-400" />
            <h1 className="text-xl font-bold text-white">ChronosOps</h1>
          </Link>

          {/* Navigation links */}
          <nav className="hidden md:flex items-center gap-1">
            {navItems.map((item) => {
              const isActive = location.pathname === item.path;
              return (
                <Link
                  key={item.path}
                  to={item.path}
                  className={`px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                    isActive
                      ? 'bg-gray-800 text-white'
                      : 'text-gray-400 hover:text-white hover:bg-gray-800/50'
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </div>

        {/* Connection status */}
        <div className="flex items-center gap-4">
          <div className="hidden lg:flex items-center gap-4">
            <StatusDot status={status.api} label="API" />
            <StatusDot
              status={wsStatus === 'connected' ? 'connected' : wsStatus === 'reconnecting' ? 'reconnecting' : 'disconnected'}
              label="WS"
            />
            <StatusDot status={status.vision} label="Video" />
            <StatusDot status={status.kubernetes} label="K8s" />
          </div>

          {/* Compact status for mobile */}
          <div className="lg:hidden flex items-center gap-2">
            <span
              className={`h-2 w-2 rounded-full ${
                status.api === 'connected' && wsStatus === 'connected'
                  ? 'bg-green-500'
                  : 'bg-yellow-500 animate-pulse'
              }`}
            />
            <span className="text-sm text-gray-400">
              {status.api === 'connected' && wsStatus === 'connected' ? 'Connected' : 'Connecting...'}
            </span>
          </div>
        </div>
      </div>
    </header>
  );
}
