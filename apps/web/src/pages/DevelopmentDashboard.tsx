/**
 * DevelopmentDashboard - Self-regenerating app development cycles overview
 */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { formatDistanceToNow } from 'date-fns';
import {
  Code,
  Plus,
  ChevronRight,
  Inbox,
  AlertTriangle,
  Play,
  RefreshCw,
  XCircle,
  Server,
  Monitor,
  CheckCircle,
  Database,
  HardDrive,
  Cloud,
} from 'lucide-react';
import { PageLayout, Section, Card } from '../components/layout/PageLayout';
import { developmentApi } from '../api/development';
import { config } from '../config/env';
import type {
  DevelopmentCycle,
  DevelopmentCycleStatus,
  DevelopmentPhase,
  StorageMode,
} from '../types';

// Helper to derive status from phase
function getStatusFromPhase(phase: DevelopmentPhase): DevelopmentCycleStatus {
  switch (phase) {
    case 'IDLE':
      return 'pending';
    case 'COMPLETED':
      return 'completed';
    case 'FAILED':
      return 'failed';
    default:
      return 'running';
  }
}

function StatusBadge({ status }: { status: DevelopmentCycleStatus }) {
  const colors: Record<DevelopmentCycleStatus, string> = {
    pending: 'bg-gray-500/10 text-gray-400 border-gray-500/30',
    running: 'bg-blue-500/10 text-blue-400 border-blue-500/30 animate-pulse',
    completed: 'bg-green-500/10 text-green-400 border-green-500/30',
    failed: 'bg-red-500/10 text-red-400 border-red-500/30',
    cancelled: 'bg-orange-500/10 text-orange-400 border-orange-500/30',
  };

  return (
    <span className={`px-2 py-0.5 text-xs rounded border ${colors[status]}`}>
      {status.toUpperCase()}
    </span>
  );
}

function PhaseBadge({ phase }: { phase: DevelopmentPhase }) {
  const colors: Record<DevelopmentPhase, string> = {
    IDLE: 'bg-gray-500/10 text-gray-400',
    ANALYZING: 'bg-observe/10 text-observe',
    DESIGNING: 'bg-orient/10 text-orient',
    CODING: 'bg-decide/10 text-decide',
    TESTING: 'bg-purple-500/10 text-purple-400',
    BUILDING: 'bg-act/10 text-act',
    DEPLOYING: 'bg-verify/10 text-verify',
    VERIFYING: 'bg-cyan-500/10 text-cyan-400',
    COMPLETED: 'bg-green-500/10 text-green-400',
    FAILED: 'bg-red-500/10 text-red-400',
  };

  return (
    <span className={`px-2 py-0.5 text-xs rounded ${colors[phase]}`}>
      {phase}
    </span>
  );
}

function CycleRow({ cycle }: { cycle: DevelopmentCycle }) {
  const status = getStatusFromPhase(cycle.phase);
  const isActive = status === 'running';
  const queryClient = useQueryClient();

  const startMutation = useMutation({
    mutationFn: () => developmentApi.start(cycle.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['development-cycles'] });
    },
  });

  return (
    <div className="border-b border-gray-800 last:border-0 hover:bg-gray-800/50 transition-colors">
      <div className="px-4 py-3 flex items-center justify-between">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3">
            {isActive && (
              <span className="w-2 h-2 bg-blue-500 rounded-full animate-pulse flex-shrink-0" />
            )}
            <h3 className="text-sm font-medium text-white truncate max-w-md">
              {cycle.requirementRaw.slice(0, 100)}{cycle.requirementRaw.length > 100 ? '...' : ''}
            </h3>
            <StatusBadge status={status} />
            <PhaseBadge phase={cycle.phase} />
          </div>
          <div className="mt-1 flex items-center gap-4 text-xs text-gray-500">
            <span>
              Iteration {cycle.iterations} / {cycle.maxIterations}
            </span>
            <span>
              Created {formatDistanceToNow(new Date(cycle.createdAt), { addSuffix: true })}
            </span>
            {cycle.completedAt && (
              <span className="text-green-400">
                Completed {formatDistanceToNow(new Date(cycle.completedAt), { addSuffix: true })}
              </span>
            )}
            {cycle.triggeredByIncidentId && (
              <span className="text-purple-400">
                From incident
              </span>
            )}
          </div>
        </div>
        <div className="ml-4 flex items-center gap-2">
          {status === 'pending' && (
            <button
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                startMutation.mutate();
              }}
              disabled={startMutation.isPending}
              className="px-2 py-1 text-xs bg-blue-600 hover:bg-blue-700 text-white rounded transition-colors flex items-center gap-1 disabled:opacity-50"
            >
              <Play size={12} />
              Start
            </button>
          )}
          <Link
            to={`/development/${cycle.id}`}
            className="text-gray-500 hover:text-white transition-colors"
          >
            <ChevronRight size={18} />
          </Link>
        </div>
      </div>
    </div>
  );
}

interface CreateCycleModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

function ServiceTypeButton({
  selected,
  onClick,
  icon: Icon,
  label,
  description,
}: {
  selected: boolean;
  onClick: () => void;
  icon: typeof Server;
  label: string;
  description: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex-1 p-3 rounded-lg border transition-colors text-left ${
        selected
          ? 'border-blue-500 bg-blue-500/10'
          : 'border-gray-700 hover:border-gray-600 bg-gray-800/50'
      }`}
    >
      <div className="flex items-center gap-2 mb-1">
        <Icon size={16} className={selected ? 'text-blue-400' : 'text-gray-400'} />
        <span className={`text-sm font-medium ${selected ? 'text-blue-400' : 'text-gray-300'}`}>
          {label}
        </span>
        {selected && <CheckCircle size={14} className="text-blue-400 ml-auto" />}
      </div>
      <p className="text-xs text-gray-500">{description}</p>
    </button>
  );
}

function CreateCycleModal({ isOpen, onClose, onSuccess }: CreateCycleModalProps) {
  const [requirement, setRequirement] = useState('');
  const [storageMode, setStorageMode] = useState<StorageMode>('memory');

  const createMutation = useMutation({
    mutationFn: () =>
      developmentApi.create({
        requirement,
        serviceType: 'backend',
        storageMode,
      }),
    onSuccess: () => {
      setRequirement('');
      setStorageMode('memory');
      onSuccess();
      onClose();
    },
  });

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-gray-900 border border-gray-700 rounded-lg w-full max-w-xl mx-4 max-h-[90vh] overflow-y-auto">
        <div className="px-4 py-3 border-b border-gray-700 flex items-center justify-between sticky top-0 bg-gray-900">
          <h2 className="text-lg font-semibold text-white">New Development Cycle</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white">
            <XCircle size={20} />
          </button>
        </div>
        <div className="p-4 space-y-4">
          {/* Service Type Selection */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Service Type
            </label>
            <div className="flex gap-2">
              <ServiceTypeButton
                selected={true}
                onClick={() => {}}
                icon={Server}
                label="Backend"
                description="REST API service"
              />
              <div className="flex-1 p-3 rounded-lg border border-gray-700 bg-gray-800/30 opacity-60 cursor-not-allowed text-left">
                <div className="flex items-center gap-2 mb-1">
                  <Monitor size={16} className="text-gray-500" />
                  <span className="text-sm font-medium text-gray-500">
                    Frontend
                  </span>
                  <span className="text-xs bg-gray-700 text-gray-400 px-1.5 py-0.5 rounded ml-auto">
                    Coming Soon
                  </span>
                </div>
                <p className="text-xs text-gray-600">React app consuming APIs</p>
              </div>
            </div>
          </div>

          {/* Storage Mode Selection */}
          <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Storage Mode
              </label>
              <div className="flex gap-2">
                <button
                  onClick={() => setStorageMode('memory')}
                  className={`flex-1 p-3 rounded-lg border transition-colors text-left ${
                    storageMode === 'memory'
                      ? 'border-blue-500 bg-blue-500/10'
                      : 'border-gray-700 hover:border-gray-600 bg-gray-800/50'
                  }`}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <Database size={16} className={storageMode === 'memory' ? 'text-blue-400' : 'text-gray-400'} />
                    <span className={`text-sm font-medium ${storageMode === 'memory' ? 'text-blue-400' : 'text-gray-300'}`}>
                      Memory
                    </span>
                    {storageMode === 'memory' && <CheckCircle size={14} className="text-blue-400 ml-auto" />}
                  </div>
                  <p className="text-xs text-gray-500">In-memory, data lost on restart</p>
                </button>
                <button
                  onClick={() => setStorageMode('sqlite')}
                  className={`flex-1 p-3 rounded-lg border transition-colors text-left ${
                    storageMode === 'sqlite'
                      ? 'border-green-500 bg-green-500/10'
                      : 'border-gray-700 hover:border-gray-600 bg-gray-800/50'
                  }`}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <HardDrive size={16} className={storageMode === 'sqlite' ? 'text-green-400' : 'text-gray-400'} />
                    <span className={`text-sm font-medium ${storageMode === 'sqlite' ? 'text-green-400' : 'text-gray-300'}`}>
                      SQLite
                    </span>
                    {storageMode === 'sqlite' && <CheckCircle size={14} className="text-green-400 ml-auto" />}
                  </div>
                  <p className="text-xs text-gray-500">Persistent, single replica</p>
                </button>
                <button
                  onClick={() => setStorageMode('postgres')}
                  className={`flex-1 p-3 rounded-lg border transition-colors text-left ${
                    storageMode === 'postgres'
                      ? 'border-purple-500 bg-purple-500/10'
                      : 'border-gray-700 hover:border-gray-600 bg-gray-800/50'
                  }`}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <Cloud size={16} className={storageMode === 'postgres' ? 'text-purple-400' : 'text-gray-400'} />
                    <span className={`text-sm font-medium ${storageMode === 'postgres' ? 'text-purple-400' : 'text-gray-300'}`}>
                      PostgreSQL
                    </span>
                    {storageMode === 'postgres' && <CheckCircle size={14} className="text-purple-400 ml-auto" />}
                  </div>
                  <p className="text-xs text-gray-500">Scalable, multi-replica</p>
                </button>
              </div>
              <p className="mt-2 text-xs text-gray-500">
                {storageMode === 'memory' && 'Data will be lost when the pod restarts. Best for testing and development.'}
                {storageMode === 'sqlite' && 'Data persists on disk. Limited to single replica due to file locking.'}
                {storageMode === 'postgres' && 'Data stored in shared PostgreSQL. Supports multiple replicas for horizontal scaling.'}
              </p>
          </div>

          {/* Requirement */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Requirement
            </label>
            <textarea
              value={requirement}
              onChange={(e) => setRequirement(e.target.value)}
              placeholder="Describe the backend API (e.g., 'Create a REST API for task management with CRUD operations')"
              className="w-full h-32 px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
            />
            <p className="mt-2 text-xs text-gray-500">
              ChronosOps will analyze this requirement, design the architecture, generate code, run tests, build, and deploy.
            </p>
          </div>
        </div>
        <div className="px-4 py-3 border-t border-gray-700 flex justify-end gap-2 sticky bottom-0 bg-gray-900">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-gray-400 hover:text-white transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => createMutation.mutate()}
            disabled={!requirement.trim() || createMutation.isPending}
            className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors disabled:opacity-50 flex items-center gap-2"
          >
            {createMutation.isPending ? (
              <>
                <RefreshCw size={14} className="animate-spin" />
                Creating...
              </>
            ) : (
              <>
                <Plus size={14} />
                Create Backend
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

type FilterStatus = 'all' | 'running' | 'completed' | 'failed' | 'pending';

export function DevelopmentDashboard() {
  const [filterStatus, setFilterStatus] = useState<FilterStatus>('all');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const queryClient = useQueryClient();

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['development-cycles'],
    queryFn: () => developmentApi.list(),
    refetchInterval: config.polling.incidentRefresh,
  });

  const allCycles = data?.data ?? [];

  // Apply filters using derived status
  const cycles = allCycles.filter((cycle) => {
    if (filterStatus === 'all') return true;
    return getStatusFromPhase(cycle.phase) === filterStatus;
  });

  // Count by status (derived from phase)
  const runningCount = allCycles.filter((c) => getStatusFromPhase(c.phase) === 'running').length;
  const completedCount = allCycles.filter((c) => getStatusFromPhase(c.phase) === 'completed').length;
  const failedCount = allCycles.filter((c) => getStatusFromPhase(c.phase) === 'failed').length;
  const pendingCount = allCycles.filter((c) => getStatusFromPhase(c.phase) === 'pending').length;

  return (
    <PageLayout title="Development Dashboard">
      <Section
        description="Self-regenerating application development cycles powered by AI"
      >
        {/* Stats Cards */}
        <div className="grid grid-cols-4 gap-4 mb-6">
          <Card>
            <div className="text-center">
              <div className="text-3xl font-bold text-blue-400">{runningCount}</div>
              <div className="text-sm text-gray-400">Running</div>
            </div>
          </Card>
          <Card>
            <div className="text-center">
              <div className="text-3xl font-bold text-yellow-400">{pendingCount}</div>
              <div className="text-sm text-gray-400">Pending</div>
            </div>
          </Card>
          <Card>
            <div className="text-center">
              <div className="text-3xl font-bold text-green-400">{completedCount}</div>
              <div className="text-sm text-gray-400">Completed</div>
            </div>
          </Card>
          <Card>
            <div className="text-center">
              <div className="text-3xl font-bold text-red-400">{failedCount}</div>
              <div className="text-sm text-gray-400">Failed</div>
            </div>
          </Card>
        </div>

        {/* Header with filters */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            {/* Status filter */}
            <div className="flex bg-gray-800 rounded-lg p-1">
              {[
                { value: 'all', label: 'All', count: allCycles.length },
                { value: 'running', label: 'Running', count: runningCount },
                { value: 'pending', label: 'Pending', count: pendingCount },
                { value: 'completed', label: 'Completed', count: completedCount },
                { value: 'failed', label: 'Failed', count: failedCount },
              ].map((option) => (
                <button
                  key={option.value}
                  onClick={() => setFilterStatus(option.value as FilterStatus)}
                  className={`px-3 py-1.5 text-xs font-medium rounded transition-colors ${
                    filterStatus === option.value
                      ? 'bg-blue-600 text-white'
                      : 'text-gray-400 hover:text-white'
                  }`}
                >
                  {option.label}
                  <span className="ml-1 opacity-70">({option.count})</span>
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => refetch()}
              className="px-3 py-1.5 text-sm border border-gray-700 rounded-lg hover:bg-gray-800 transition-colors text-gray-400"
            >
              Refresh
            </button>
            <button
              onClick={() => setShowCreateModal(true)}
              className="px-3 py-1.5 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors flex items-center gap-1"
            >
              <Plus size={14} />
              New Cycle
            </button>
          </div>
        </div>

        <Card padding="none">
          {isLoading && (
            <div className="py-12 text-center text-gray-500">
              <div className="animate-spin h-8 w-8 border-2 border-blue-500 border-t-transparent rounded-full mx-auto mb-4" />
              <p>Loading development cycles...</p>
            </div>
          )}

          {error && (
            <div className="py-12 text-center text-red-500">
              <AlertTriangle size={48} className="mx-auto mb-3 opacity-50" />
              <p>Failed to load development cycles</p>
              <p className="text-sm text-gray-500 mt-2">
                {error instanceof Error ? error.message : 'Unknown error'}
              </p>
              <button
                onClick={() => refetch()}
                className="mt-4 px-4 py-2 text-sm bg-gray-800 hover:bg-gray-700 rounded-lg transition-colors"
              >
                Retry
              </button>
            </div>
          )}

          {!isLoading && !error && cycles.length === 0 && (
            <div className="py-12 text-center text-gray-500">
              <Inbox size={48} className="mx-auto mb-4 opacity-50" />
              <p>No development cycles found</p>
              <p className="text-sm text-gray-600 mt-2">
                {filterStatus !== 'all'
                  ? 'Try adjusting your filters'
                  : 'Create a new cycle to start building'}
              </p>
              <button
                onClick={() => setShowCreateModal(true)}
                className="mt-4 px-4 py-2 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors flex items-center gap-2 mx-auto"
              >
                <Code size={16} />
                Create First Cycle
              </button>
            </div>
          )}

          {!isLoading && !error && cycles.length > 0 && (
            <div>
              {/* Table header */}
              <div className="px-4 py-2 border-b border-gray-700 bg-gray-800/50">
                <div className="flex items-center text-xs text-gray-500 font-medium">
                  <span className="flex-1">Requirement</span>
                  <span className="w-32 text-right">Status</span>
                </div>
              </div>
              {cycles.map((cycle) => (
                <CycleRow key={cycle.id} cycle={cycle} />
              ))}
            </div>
          )}
        </Card>
      </Section>

      <CreateCycleModal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        onSuccess={() => queryClient.invalidateQueries({ queryKey: ['development-cycles'] })}
      />
    </PageLayout>
  );
}
