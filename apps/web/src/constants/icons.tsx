/**
 * Icon Constants - Centralized icon definitions for ChronosOps
 * Uses Lucide React icons mapped to domain concepts
 */
import {
  Eye,
  Compass,
  Lightbulb,
  Zap,
  CheckCircle,
  CheckCircle2,
  XCircle,
  Circle,
  RotateCcw,
  RefreshCw,
  TrendingUp,
  Wrench,
  Video,
  FileText,
  LineChart,
  Settings,
  User,
  Search,
  AlertTriangle,
  Bot,
  Shield,
  Clock,
  Activity,
  type LucideIcon,
} from 'lucide-react';

// OODA Phase Icons with semantic mapping
export const OODA_ICONS: Record<string, LucideIcon> = {
  IDLE: Circle,
  OBSERVING: Eye,
  ORIENTING: Compass,
  DECIDING: Lightbulb,
  ACTING: Zap,
  VERIFYING: CheckCircle,
  DONE: CheckCircle2,
  FAILED: XCircle,
} as const;

// OODA Phase Colors (matching Tailwind config)
export const OODA_COLORS: Record<string, string> = {
  IDLE: 'text-gray-400',
  OBSERVING: 'text-observe',
  ORIENTING: 'text-orient',
  DECIDING: 'text-decide',
  ACTING: 'text-act',
  VERIFYING: 'text-verify',
  DONE: 'text-green-400',
  FAILED: 'text-red-400',
} as const;

// Action Type Icons
export const ACTION_ICONS: Record<string, LucideIcon> = {
  rollback: RotateCcw,
  restart: RefreshCw,
  scale: TrendingUp,
  manual: Wrench,
} as const;

// Evidence Type Icons
export const EVIDENCE_ICONS: Record<string, LucideIcon> = {
  video_frame: Video,
  log: FileText,
  metric: LineChart,
  k8s_event: Settings,
  user_report: User,
} as const;

// Timeline Event Type Icons
export const TIMELINE_ICONS: Record<string, LucideIcon> = {
  evidence: Search,
  hypothesis: Lightbulb,
  action: Zap,
  phase_change: Circle,
} as const;

// Execution Mode Icons
export const EXECUTION_MODE_ICONS: Record<string, LucideIcon> = {
  kubernetes: Settings,
  simulated: Bot,
  auto: Activity,
} as const;

// Status Icons
export const STATUS_ICONS = {
  warning: AlertTriangle,
  error: XCircle,
  success: CheckCircle,
  info: Circle,
  shield: Shield,
  clock: Clock,
  activity: Activity,
  robot: Bot,
  search: Search,
} as const;
