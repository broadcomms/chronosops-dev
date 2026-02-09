/**
 * Icon - Reusable icon wrapper component for consistent sizing
 * Uses Lucide React icons with predefined size variants
 */
import type { LucideIcon } from 'lucide-react';

export interface IconProps {
  icon: LucideIcon;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
}

const sizes: Record<string, number> = {
  xs: 12,
  sm: 14,
  md: 18,
  lg: 24,
  xl: 32,
};

export function Icon({ icon: IconComponent, size = 'md', className = '' }: IconProps) {
  return <IconComponent size={sizes[size]} className={className} strokeWidth={2} />;
}

// Re-export commonly used icons for convenience
export {
  // OODA Phase Icons
  Eye,
  Compass,
  Lightbulb,
  Zap,
  CheckCircle,
  CheckCircle2,
  XCircle,
  Circle,
  // Action Icons
  RotateCcw,
  RefreshCw,
  TrendingUp,
  Shield,
  ShieldCheck,
  // Evidence Icons
  Video,
  FileText,
  LineChart,
  Settings,
  User,
  Search,
  AlertTriangle,
  Bot,
  // Status Icons
  Clock,
  Timer,
  Activity,
  Play,
  Pause,
  SkipBack,
  SkipForward,
  ChevronUp,
  ChevronDown,
  X,
  // Additional
  Wrench,
  Server,
  Database,
  Wifi,
  WifiOff,
  MonitorPlay,
  Brain,
  ScanEye,
} from 'lucide-react';
