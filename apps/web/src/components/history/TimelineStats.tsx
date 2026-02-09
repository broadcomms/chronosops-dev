/**
 * Timeline Stats Component
 * Displays statistics overview for the unified timeline
 */
import { 
  Activity, 
  TrendingUp, 
  Clock,
  BarChart3,
} from 'lucide-react';
import type { TimelineEntityType } from '@chronosops/shared';
import { ENTITY_CONFIG } from './EntityIcon';
import type { TimelineStats } from '../../api/timeline';

interface TimelineStatsBarProps {
  stats: TimelineStats;
  isLoading?: boolean;
}

export function TimelineStatsBar({ stats, isLoading }: TimelineStatsBarProps) {
  if (isLoading) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 animate-pulse">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="p-3 bg-gray-800/50 border border-gray-700 rounded-lg">
            <div className="w-20 h-4 bg-gray-700 rounded mb-2" />
            <div className="w-12 h-6 bg-gray-700 rounded" />
          </div>
        ))}
      </div>
    );
  }
  
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      {/* Total Events */}
      <StatCard
        icon={<Activity size={18} className="text-cyan-400" />}
        label="Total Events"
        value={stats.totalEvents}
        color="cyan"
      />
      
      {/* Last 24 Hours */}
      <StatCard
        icon={<Clock size={18} className="text-green-400" />}
        label="Last 24 Hours"
        value={stats.recentActivity.last24Hours}
        color="green"
      />
      
      {/* Last 7 Days */}
      <StatCard
        icon={<TrendingUp size={18} className="text-blue-400" />}
        label="Last 7 Days"
        value={stats.recentActivity.last7Days}
        color="blue"
      />
      
      {/* Last 30 Days */}
      <StatCard
        icon={<BarChart3 size={18} className="text-purple-400" />}
        label="Last 30 Days"
        value={stats.recentActivity.last30Days}
        color="purple"
      />
    </div>
  );
}

interface StatCardProps {
  icon: React.ReactNode;
  label: string;
  value: number;
  color: 'cyan' | 'green' | 'blue' | 'purple';
}

function StatCard({ icon, label, value, color }: StatCardProps) {
  const borderColors = {
    cyan: 'border-cyan-500/30',
    green: 'border-green-500/30',
    blue: 'border-blue-500/30',
    purple: 'border-purple-500/30',
  };
  
  return (
    <div className={`p-3 bg-gray-800/50 border ${borderColors[color]} rounded-lg`}>
      <div className="flex items-center gap-2 text-gray-400 text-xs mb-1">
        {icon}
        <span>{label}</span>
      </div>
      <div className="text-2xl font-bold text-gray-200">
        {value.toLocaleString()}
      </div>
    </div>
  );
}

interface EntityTypeBreakdownProps {
  byEntityType: Record<TimelineEntityType, number>;
}

export function EntityTypeBreakdown({ byEntityType }: EntityTypeBreakdownProps) {
  const total = Object.values(byEntityType).reduce((a, b) => a + b, 0);
  
  if (total === 0) {
    return null;
  }
  
  return (
    <div className="flex items-center gap-4 flex-wrap">
      {(Object.entries(byEntityType) as [TimelineEntityType, number][]).map(([type, count]) => {
        if (count === 0) return null;
        
        const config = ENTITY_CONFIG[type];
        const percentage = Math.round((count / total) * 100);
        const IconComponent = config.icon;
        
        return (
          <div 
            key={type} 
            className="flex items-center gap-2 text-sm"
            title={`${count} ${config.label} events (${percentage}%)`}
          >
            <div className={`${config.bgColor} p-1 rounded`}>
              <IconComponent size={12} className={config.color} />
            </div>
            <span className="text-gray-400">{config.label}:</span>
            <span className="text-gray-200 font-medium">{count}</span>
          </div>
        );
      })}
    </div>
  );
}
