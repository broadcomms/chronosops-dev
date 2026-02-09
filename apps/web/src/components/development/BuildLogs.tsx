/**
 * BuildLogs - Display build pipeline output and test results
 */
import { memo } from 'react';
import {
  Terminal,
  CheckCircle,
  XCircle,
  Clock,
  Play,
  SkipForward,
  AlertTriangle,
} from 'lucide-react';
import type { BuildResult, BuildStage, TestResults } from '../../types';

interface BuildLogsProps {
  buildResult: BuildResult | null;
  className?: string;
}

const stageStatusConfig: Record<BuildStage['status'], {
  icon: typeof CheckCircle;
  color: string;
  bgColor: string;
}> = {
  pending: {
    icon: Clock,
    color: 'text-gray-400',
    bgColor: 'bg-gray-500/10',
  },
  running: {
    icon: Play,
    color: 'text-blue-400',
    bgColor: 'bg-blue-500/10',
  },
  completed: {
    icon: CheckCircle,
    color: 'text-green-400',
    bgColor: 'bg-green-500/10',
  },
  failed: {
    icon: XCircle,
    color: 'text-red-400',
    bgColor: 'bg-red-500/10',
  },
  skipped: {
    icon: SkipForward,
    color: 'text-gray-500',
    bgColor: 'bg-gray-500/5',
  },
};

interface StageRowProps {
  stage: BuildStage;
  isLast: boolean;
}

const StageRow = memo(function StageRow({ stage, isLast }: StageRowProps) {
  const config = stageStatusConfig[stage.status];
  const Icon = config.icon;

  return (
    <div className="relative">
      {/* Connector line */}
      {!isLast && (
        <div className="absolute left-4 top-8 bottom-0 w-0.5 bg-gray-700" />
      )}

      <div className="flex items-start gap-3">
        {/* Status icon */}
        <div className={`p-2 rounded-lg ${config.bgColor} ${config.color}`}>
          <Icon size={16} className={stage.status === 'running' ? 'animate-pulse' : ''} />
        </div>

        {/* Stage content */}
        <div className="flex-1 pb-4">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-white capitalize">
              {stage.name.replace(/_/g, ' ')}
            </span>
            <span className={`text-xs ${config.color}`}>
              {stage.status.toUpperCase()}
            </span>
          </div>

          {/* Logs */}
          {(stage.logs ?? []).length > 0 && (
            <div className="mt-2 p-2 bg-gray-900/50 rounded text-xs font-mono text-gray-400 max-h-32 overflow-y-auto">
              {(stage.logs ?? []).map((log, i) => (
                <div key={i} className="whitespace-pre-wrap">
                  {log}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
});

interface TestResultsDisplayProps {
  results: TestResults;
}

const TestResultsDisplay = memo(function TestResultsDisplay({ results }: TestResultsDisplayProps) {
  const total = results.passed + results.failed + results.skipped;
  const passRate = total > 0 ? (results.passed / total) * 100 : 0;
  const coverageMet = results.coverage >= 80;

  return (
    <div className="mt-4 p-4 bg-gray-900/50 rounded-lg border border-gray-700">
      <h4 className="text-sm font-medium text-gray-300 mb-3">Test Results</h4>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4 mb-4">
        <div className="text-center">
          <div className="text-2xl font-bold text-green-400">{results.passed}</div>
          <div className="text-xs text-gray-500">Passed</div>
        </div>
        <div className="text-center">
          <div className="text-2xl font-bold text-red-400">{results.failed}</div>
          <div className="text-xs text-gray-500">Failed</div>
        </div>
        <div className="text-center">
          <div className="text-2xl font-bold text-gray-400">{results.skipped}</div>
          <div className="text-xs text-gray-500">Skipped</div>
        </div>
        <div className="text-center">
          <div className={`text-2xl font-bold ${coverageMet ? 'text-green-400' : 'text-yellow-400'}`}>
            {results.coverage}%
          </div>
          <div className="text-xs text-gray-500">Coverage</div>
        </div>
      </div>

      {/* Progress bar */}
      <div className="h-2 bg-gray-700 rounded-full overflow-hidden mb-2">
        <div
          className="h-full bg-green-500 transition-all duration-500"
          style={{ width: `${passRate}%` }}
        />
      </div>
      <div className="text-xs text-gray-500 text-right">
        {passRate.toFixed(1)}% pass rate ({results.duration}ms)
      </div>

      {/* Failures */}
      {(results.failures ?? []).length > 0 && (
        <div className="mt-4">
          <h5 className="text-xs font-medium text-red-400 mb-2 flex items-center gap-1">
            <AlertTriangle size={12} />
            Failed Tests
          </h5>
          <div className="space-y-2">
            {(results.failures ?? []).map((failure, i) => (
              <div key={i} className="p-2 bg-red-500/10 border border-red-500/20 rounded text-xs">
                <div className="font-medium text-red-400">{failure.testName}</div>
                <div className="text-gray-400 mt-1">{failure.error}</div>
                {failure.stack && (
                  <pre className="mt-1 text-gray-500 text-[10px] overflow-x-auto">
                    {failure.stack}
                  </pre>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
});

export const BuildLogs = memo(function BuildLogs({
  buildResult,
  className = '',
}: BuildLogsProps) {
  if (!buildResult) {
    return (
      <div className={`bg-gray-800/50 border border-gray-700 rounded-lg p-4 ${className}`}>
        <div className="flex items-center gap-2 mb-4">
          <Terminal size={18} className="text-gray-400" />
          <h3 className="text-sm font-medium text-gray-300">Build Pipeline</h3>
        </div>
        <div className="text-center py-8 text-gray-500">
          <Terminal size={32} className="mx-auto mb-2 opacity-50" />
          <p className="text-sm">Build not started</p>
        </div>
      </div>
    );
  }

  return (
    <div className={`bg-gray-800/50 border border-gray-700 rounded-lg p-4 ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Terminal size={18} className={buildResult.success ? 'text-green-400' : 'text-red-400'} />
          <h3 className="text-sm font-medium text-gray-300">Build Pipeline</h3>
        </div>
        <div className="flex items-center gap-3">
          {buildResult.imageTag && (
            <span className="text-xs text-gray-500">
              Image: <code className="text-purple-400">{buildResult.imageTag}</code>
            </span>
          )}
          <span className="text-xs text-gray-500">
            Duration: {(buildResult.duration / 1000).toFixed(1)}s
          </span>
          <span
            className={`px-2 py-0.5 text-xs rounded ${
              buildResult.success
                ? 'bg-green-500/10 text-green-400'
                : 'bg-red-500/10 text-red-400'
            }`}
          >
            {buildResult.success ? 'SUCCESS' : 'FAILED'}
          </span>
        </div>
      </div>

      {/* Stages */}
      {(buildResult.stages ?? []).length > 0 && (
        <div className="space-y-1">
          {(buildResult.stages ?? []).map((stage, index) => (
            <StageRow
              key={stage.name}
              stage={stage}
              isLast={index === (buildResult.stages ?? []).length - 1}
            />
          ))}
        </div>
      )}

      {/* Test Results */}
      {buildResult.testResults && (
        <TestResultsDisplay results={buildResult.testResults} />
      )}

      {/* Build Logs Summary */}
      {(buildResult.logs ?? []).length > 0 && (
        <div className="mt-4">
          <h4 className="text-xs font-medium text-gray-400 mb-2">Build Output</h4>
          <div className="p-3 bg-gray-900/50 rounded text-xs font-mono text-gray-400 max-h-40 overflow-y-auto">
            {(buildResult.logs ?? []).map((log, i) => (
              <div key={i} className="whitespace-pre-wrap">
                {log}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
});
