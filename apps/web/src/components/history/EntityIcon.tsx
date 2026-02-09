/**
 * Entity Icon Component
 * Maps timeline entity types to their corresponding icons
 */
import {
  AlertTriangle,
  Code2,
  Lightbulb,
  Zap,
  History,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import type { TimelineEntityType } from '@chronosops/shared';

// Icon and color configuration for each entity type
export const ENTITY_CONFIG: Record<TimelineEntityType, {
  icon: LucideIcon;
  label: string;
  color: string;
  bgColor: string;
  borderColor: string;
}> = {
  incident: {
    icon: AlertTriangle,
    label: 'Incident',
    color: 'text-red-400',
    bgColor: 'bg-red-500/20',
    borderColor: 'border-red-500/30',
  },
  development_cycle: {
    icon: Wrench,
    label: 'Development',
    color: 'text-blue-400',
    bgColor: 'bg-blue-500/20',
    borderColor: 'border-blue-500/30',
  },
  code_evolution: {
    icon: Code2,
    label: 'Evolution',
    color: 'text-purple-400',
    bgColor: 'bg-purple-500/20',
    borderColor: 'border-purple-500/30',
  },
  learned_pattern: {
    icon: Lightbulb,
    label: 'Pattern',
    color: 'text-yellow-400',
    bgColor: 'bg-yellow-500/20',
    borderColor: 'border-yellow-500/30',
  },
  action: {
    icon: Zap,
    label: 'Action',
    color: 'text-cyan-400',
    bgColor: 'bg-cyan-500/20',
    borderColor: 'border-cyan-500/30',
  },
  reconstruction: {
    icon: History,
    label: 'Reconstruction',
    color: 'text-green-400',
    bgColor: 'bg-green-500/20',
    borderColor: 'border-green-500/30',
  },
};

interface EntityIconProps {
  entityType: TimelineEntityType;
  size?: 'sm' | 'md' | 'lg';
  showBackground?: boolean;
  className?: string;
}

const sizeClasses = {
  sm: { icon: 14, wrapper: 'h-6 w-6' },
  md: { icon: 18, wrapper: 'h-8 w-8' },
  lg: { icon: 24, wrapper: 'h-10 w-10' },
};

export function EntityIcon({ 
  entityType, 
  size = 'md', 
  showBackground = true,
  className = '' 
}: EntityIconProps) {
  const config = ENTITY_CONFIG[entityType];
  const sizeConfig = sizeClasses[size];
  const IconComponent = config.icon;
  
  if (!showBackground) {
    return (
      <IconComponent 
        size={sizeConfig.icon} 
        className={`${config.color} ${className}`} 
      />
    );
  }
  
  return (
    <div 
      className={`
        ${sizeConfig.wrapper} 
        ${config.bgColor} 
        rounded-lg flex items-center justify-center
        ${className}
      `}
    >
      <IconComponent size={sizeConfig.icon} className={config.color} />
    </div>
  );
}

/**
 * Status badge color mapping based on timeline status colors
 */
export const STATUS_COLORS: Record<string, string> = {
  green: 'bg-green-500/20 text-green-400 border-green-500/30',
  red: 'bg-red-500/20 text-red-400 border-red-500/30',
  yellow: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  blue: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  purple: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
  cyan: 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30',
  gray: 'bg-gray-500/20 text-gray-400 border-gray-500/30',
};

interface StatusBadgeProps {
  status: string;
  color: string;
  className?: string;
}

export function StatusBadge({ status, color, className = '' }: StatusBadgeProps) {
  const colorClasses = STATUS_COLORS[color] || STATUS_COLORS.gray;
  
  return (
    <span 
      className={`
        px-2 py-0.5 text-xs font-medium rounded border
        ${colorClasses}
        ${className}
      `}
    >
      {status}
    </span>
  );
}
