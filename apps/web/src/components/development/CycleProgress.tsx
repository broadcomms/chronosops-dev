/**
 * CycleProgress - Development cycle phase visualization
 * Shows OODA-style progress through development phases
 */
import { memo } from 'react';
import {
  Search,
  Compass,
  Code,
  TestTube,
  Package,
  Rocket,
  CheckCircle,
  XCircle,
  Circle,
  type LucideIcon,
} from 'lucide-react';
import type { DevelopmentPhase } from '../../types';

interface CycleProgressProps {
  currentPhase: DevelopmentPhase;
  iteration: number;
  maxIterations: number;
  className?: string;
}

const DEVELOPMENT_PHASES: DevelopmentPhase[] = [
  'ANALYZING',
  'DESIGNING',
  'CODING',
  'TESTING',
  'BUILDING',
  'DEPLOYING',
  'VERIFYING',
];

const phaseConfig: Record<DevelopmentPhase, {
  icon: LucideIcon;
  color: string;
  bgColor: string;
  borderColor: string;
  label: string;
}> = {
  IDLE: {
    icon: Circle,
    color: 'text-gray-400',
    bgColor: 'bg-gray-500/10',
    borderColor: 'border-gray-500',
    label: 'Idle',
  },
  ANALYZING: {
    icon: Search,
    color: 'text-observe',
    bgColor: 'bg-observe/10',
    borderColor: 'border-observe',
    label: 'Analyzing',
  },
  DESIGNING: {
    icon: Compass,
    color: 'text-orient',
    bgColor: 'bg-orient/10',
    borderColor: 'border-orient',
    label: 'Designing',
  },
  CODING: {
    icon: Code,
    color: 'text-decide',
    bgColor: 'bg-decide/10',
    borderColor: 'border-decide',
    label: 'Coding',
  },
  TESTING: {
    icon: TestTube,
    color: 'text-purple-400',
    bgColor: 'bg-purple-500/10',
    borderColor: 'border-purple-500',
    label: 'Testing',
  },
  BUILDING: {
    icon: Package,
    color: 'text-act',
    bgColor: 'bg-act/10',
    borderColor: 'border-act',
    label: 'Building',
  },
  DEPLOYING: {
    icon: Rocket,
    color: 'text-verify',
    bgColor: 'bg-verify/10',
    borderColor: 'border-verify',
    label: 'Deploying',
  },
  VERIFYING: {
    icon: CheckCircle,
    color: 'text-cyan-400',
    bgColor: 'bg-cyan-500/10',
    borderColor: 'border-cyan-500',
    label: 'Verifying',
  },
  COMPLETED: {
    icon: CheckCircle,
    color: 'text-green-400',
    bgColor: 'bg-green-500/10',
    borderColor: 'border-green-500',
    label: 'Completed',
  },
  FAILED: {
    icon: XCircle,
    color: 'text-red-400',
    bgColor: 'bg-red-500/10',
    borderColor: 'border-red-500',
    label: 'Failed',
  },
};

export const CycleProgress = memo(function CycleProgress({
  currentPhase,
  iteration: _iteration, // Reserved for future retry count display
  maxIterations: _maxIterations, // Reserved for future retry count display
  className = '',
}: CycleProgressProps) {
  const currentPhaseIndex = DEVELOPMENT_PHASES.indexOf(currentPhase);
  const isComplete = currentPhase === 'COMPLETED';
  const isFailed = currentPhase === 'FAILED';

  return (
    <div className={className}>
      {/* Phase Progress Pipeline - Compact horizontal layout */}
      <div className="flex items-center justify-between gap-2">
        {DEVELOPMENT_PHASES.map((phase, index) => {
          const config = phaseConfig[phase];
          const Icon = config.icon;
          const isActive = phase === currentPhase;
          const isCompleted = isComplete || index < currentPhaseIndex;

          return (
            <div key={phase} className="flex items-center flex-1 min-w-0">
              <div
                className={`
                  flex-1 py-2 px-1 rounded-lg text-xs font-medium transition-all border flex flex-col items-center gap-1
                  ${isActive ? `${config.bgColor} ${config.borderColor} ${config.color} ring-2 ring-offset-1 ring-offset-gray-900 ring-current` : ''}
                  ${isCompleted && !isActive ? `${config.bgColor} ${config.borderColor} ${config.color} opacity-70` : ''}
                  ${!isActive && !isCompleted ? 'bg-gray-800/50 border-gray-700 text-gray-500' : ''}
                  ${isFailed && isActive ? 'bg-red-500/10 border-red-500 text-red-400 ring-2 ring-red-500' : ''}
                `}
                title={config.label}
              >
                <Icon size={16} className={isActive ? 'animate-pulse' : ''} />
                <span className="truncate text-[10px] leading-tight">{config.label}</span>
              </div>
              {index < DEVELOPMENT_PHASES.length - 1 && (
                <div
                  className={`w-2 h-0.5 flex-shrink-0 ${
                    isCompleted ? config.borderColor.replace('border-', 'bg-') : 'bg-gray-700'
                  }`}
                />
              )}
            </div>
          );
        })}
      </div>

      {/* Status Badge - Only show on completion/failure */}
      {(isComplete || isFailed) && (
        <div className="mt-3 flex justify-center">
          <div
            className={`
              px-3 py-1.5 rounded-full flex items-center gap-2 text-xs font-medium
              ${isComplete ? 'bg-green-500/10 text-green-400 border border-green-500/30' : ''}
              ${isFailed ? 'bg-red-500/10 text-red-400 border border-red-500/30' : ''}
            `}
          >
            {isComplete ? (
              <>
                <CheckCircle size={14} />
                Cycle Complete
              </>
            ) : (
              <>
                <XCircle size={14} />
                Cycle Failed
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
});
