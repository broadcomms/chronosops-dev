/**
 * MetricsGauge - Circular progress gauge for displaying resource usage
 * Beautiful, animated gauge component for CPU, Memory, and other metrics
 */

interface MetricsGaugeProps {
  /** Current value */
  value: number;
  /** Maximum value (for percentage calculation) */
  max: number;
  /** Label shown below the gauge */
  label: string;
  /** Unit to display (%, MB, etc.) */
  unit: string;
  /** Size of the gauge */
  size?: 'sm' | 'md' | 'lg';
  /** Color theme */
  theme?: 'cpu' | 'memory' | 'default';
  /** Status-based coloring */
  status?: 'healthy' | 'warning' | 'critical';
}

const SIZE_CONFIG = {
  sm: { diameter: 60, strokeWidth: 4, fontSize: 'text-xs' },
  md: { diameter: 80, strokeWidth: 5, fontSize: 'text-sm' },
  lg: { diameter: 100, strokeWidth: 6, fontSize: 'text-base' },
};

const THEME_COLORS = {
  cpu: { primary: '#3B82F6', secondary: '#60A5FA', track: '#1E3A5F' },
  memory: { primary: '#8B5CF6', secondary: '#A78BFA', track: '#2E1F5E' },
  default: { primary: '#10B981', secondary: '#34D399', track: '#064E3B' },
};

const STATUS_COLORS = {
  healthy: { primary: '#10B981', glow: 'rgba(16, 185, 129, 0.3)' },
  warning: { primary: '#F59E0B', glow: 'rgba(245, 158, 11, 0.3)' },
  critical: { primary: '#EF4444', glow: 'rgba(239, 68, 68, 0.4)' },
};

export function MetricsGauge({
  value,
  max,
  label,
  unit,
  size = 'md',
  theme = 'default',
  status = 'healthy',
}: MetricsGaugeProps) {
  const config = SIZE_CONFIG[size];
  const themeColors = THEME_COLORS[theme];
  const statusColors = STATUS_COLORS[status];
  
  const radius = (config.diameter - config.strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const percentage = Math.min((value / max) * 100, 100);
  const strokeDashoffset = circumference - (percentage / 100) * circumference;

  const displayValue = value >= 100 ? value.toFixed(0) : value >= 10 ? value.toFixed(1) : value.toFixed(2);

  return (
    <div className="flex flex-col items-center gap-1">
      <div className="relative" style={{ width: config.diameter, height: config.diameter }}>
        {/* Background glow effect */}
        <div 
          className="absolute inset-0 rounded-full blur-md opacity-40"
          style={{ 
            background: `radial-gradient(circle, ${statusColors.glow} 0%, transparent 70%)`,
          }}
        />
        
        <svg
          width={config.diameter}
          height={config.diameter}
          className="transform -rotate-90"
        >
          {/* Track */}
          <circle
            cx={config.diameter / 2}
            cy={config.diameter / 2}
            r={radius}
            fill="none"
            stroke={themeColors.track}
            strokeWidth={config.strokeWidth}
          />
          {/* Progress */}
          <circle
            cx={config.diameter / 2}
            cy={config.diameter / 2}
            r={radius}
            fill="none"
            stroke={statusColors.primary}
            strokeWidth={config.strokeWidth}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={strokeDashoffset}
            className="transition-all duration-500 ease-out"
            style={{
              filter: `drop-shadow(0 0 4px ${statusColors.primary})`,
            }}
          />
        </svg>
        
        {/* Center value */}
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className={`font-bold text-white ${config.fontSize}`}>
            {displayValue}
          </span>
          <span className="text-[8px] text-gray-400 -mt-0.5">{unit}</span>
        </div>
      </div>
      
      <span className="text-[10px] text-gray-400 font-medium">{label}</span>
    </div>
  );
}

/**
 * Mini metric display for inline stats
 */
interface MiniMetricProps {
  label: string;
  value: number | string;
  unit: string;
  status?: 'healthy' | 'warning' | 'critical';
  icon?: React.ReactNode;
}

export function MiniMetric({ label, value, unit, status = 'healthy', icon }: MiniMetricProps) {
  const statusColors = {
    healthy: 'text-green-400',
    warning: 'text-yellow-400',
    critical: 'text-red-400',
  };

  const bgColors = {
    healthy: 'bg-green-400/10',
    warning: 'bg-yellow-400/10',
    critical: 'bg-red-400/10',
  };

  return (
    <div className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg ${bgColors[status]}`}>
      {icon && <span className={statusColors[status]}>{icon}</span>}
      <div className="flex flex-col">
        <span className="text-[9px] text-gray-500 uppercase tracking-wide">{label}</span>
        <span className={`text-sm font-semibold ${statusColors[status]}`}>
          {typeof value === 'number' ? value.toFixed(value >= 100 ? 0 : 2) : value}
          <span className="text-[10px] text-gray-500 ml-0.5">{unit}</span>
        </span>
      </div>
    </div>
  );
}

/**
 * Bar-style metric gauge
 */
interface MetricBarProps {
  label: string;
  value: number;
  max: number;
  unit: string;
  status?: 'healthy' | 'warning' | 'critical';
  showLimit?: boolean;
}

export function MetricBar({ label, value, max, unit, status = 'healthy', showLimit = false }: MetricBarProps) {
  const percentage = Math.min((value / max) * 100, 100);
  
  const statusColors = {
    healthy: { bar: 'bg-gradient-to-r from-green-500 to-emerald-400', glow: 'shadow-green-500/30' },
    warning: { bar: 'bg-gradient-to-r from-yellow-500 to-amber-400', glow: 'shadow-yellow-500/30' },
    critical: { bar: 'bg-gradient-to-r from-red-500 to-rose-400', glow: 'shadow-red-500/30' },
  };

  const colors = statusColors[status];

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-gray-400 uppercase tracking-wide">{label}</span>
        <span className="text-xs text-gray-300">
          {value.toFixed(value >= 100 ? 0 : 1)}
          <span className="text-gray-500">/{max}{unit}</span>
        </span>
      </div>
      <div className="relative h-2 bg-gray-700/50 rounded-full overflow-hidden">
        <div
          className={`absolute inset-y-0 left-0 ${colors.bar} rounded-full transition-all duration-500 ease-out shadow-lg ${colors.glow}`}
          style={{ width: `${percentage}%` }}
        />
        {showLimit && (
          <div className="absolute inset-y-0 right-0 w-px bg-gray-500" />
        )}
      </div>
    </div>
  );
}
