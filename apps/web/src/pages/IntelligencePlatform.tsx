/**
 * IntelligencePlatform - Incident reconstruction and pattern learning hub
 */
import { useState, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { formatDistanceToNow } from 'date-fns';
import { toast } from 'sonner';
import {
  Brain,
  ChevronRight,
  Clock,
  FileText,
  Inbox,
  AlertTriangle,
} from 'lucide-react';
import { PageLayout, Section, Card, Grid } from '../components/layout/PageLayout';
import { PatternLibrary } from '../components/intelligence/PatternLibrary';
import { intelligenceApi } from '../api/intelligence';
import { useWebSocket } from '../hooks/useWebSocket';
import { config } from '../config/env';
import type { ReconstructedIncident, KnowledgeBaseStats } from '../types';

// Default stats for fallback when API returns empty
const DEFAULT_STATS: KnowledgeBaseStats = {
  totalPatterns: 0,
  highConfidenceCount: 0,
  byType: {
    detection: 0,
    diagnostic: 0,
    resolution: 0,
    prevention: 0,
  },
  mostApplied: [],
};

function ReconstructionRow({ reconstruction }: { reconstruction: ReconstructedIncident }) {
  return (
    <Link
      to={`/intelligence/reconstructions/${reconstruction.id}`}
      className="block border-b border-gray-800 last:border-0 hover:bg-gray-800/50 transition-colors"
    >
      <div className="px-4 py-3 flex items-center justify-between">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3">
            <FileText size={16} className="text-blue-400" />
            <h3 className="text-sm font-medium text-white truncate">
              {reconstruction.rootCause.slice(0, 80)}{reconstruction.rootCause.length > 80 ? '...' : ''}
            </h3>
          </div>
          <div className="mt-1 flex items-center gap-4 text-xs text-gray-500">
            <span>{reconstruction.timeline.length} events</span>
            <span>{reconstruction.causalChain.length} causal links</span>
            <span>
              {formatDistanceToNow(new Date(reconstruction.createdAt), { addSuffix: true })}
            </span>
          </div>
        </div>
        <div className="ml-4 text-gray-500">
          <ChevronRight size={18} />
        </div>
      </div>
    </Link>
  );
}

function StatsCard({ stats }: { stats: KnowledgeBaseStats }) {
  return (
    <Grid cols={4} gap="sm">
      <Card>
        <div className="text-center">
          <div className="text-3xl font-bold text-purple-400">{stats.totalPatterns}</div>
          <div className="text-sm text-gray-400">Total Patterns</div>
        </div>
      </Card>
      <Card>
        <div className="text-center">
          <div className="text-3xl font-bold text-green-400">{stats.highConfidenceCount}</div>
          <div className="text-sm text-gray-400">High Confidence</div>
        </div>
      </Card>
      <Card>
        <div className="text-center">
          <div className="text-3xl font-bold text-observe">{stats.byType.detection}</div>
          <div className="text-sm text-gray-400">Detection</div>
        </div>
      </Card>
      <Card>
        <div className="text-center">
          <div className="text-3xl font-bold text-act">{stats.byType.resolution}</div>
          <div className="text-sm text-gray-400">Resolution</div>
        </div>
      </Card>
    </Grid>
  );
}

type Tab = 'patterns' | 'reconstructions';

export function IntelligencePlatform() {
  const [activeTab, setActiveTab] = useState<Tab>('patterns');
  const queryClient = useQueryClient();
  const { lastMessage } = useWebSocket();

  const { data: statsData } = useQuery({
    queryKey: ['intelligence-stats'],
    queryFn: () => intelligenceApi.getStats(),
    refetchInterval: config.polling.incidentRefresh,
  });

  const { data: patternsData, isLoading: patternsLoading, error: patternsError } = useQuery({
    queryKey: ['intelligence-patterns'],
    queryFn: () => intelligenceApi.listPatterns({ limit: 50 }),
    refetchInterval: config.polling.incidentRefresh,
  });

  const { data: reconstructionsData, isLoading: reconstructionsLoading, error: reconstructionsError } = useQuery({
    queryKey: ['intelligence-reconstructions'],
    queryFn: () => intelligenceApi.listReconstructions({ limit: 20 }),
    refetchInterval: config.polling.incidentRefresh,
  });

  // Listen for WebSocket intelligence events
  useEffect(() => {
    if (!lastMessage) return;

    if (lastMessage.type === 'intelligence:pattern_learned') {
      const payload = lastMessage.payload as {
        patternName?: string;
        patternsCount?: number;
        sourceIncidentId?: string;
      };
      // Show toast notification
      toast.success(`New pattern learned: "${payload.patternName ?? 'Unknown'}"`, {
        description: `${payload.patternsCount ?? 1} pattern(s) from incident`,
      });
      // Invalidate queries to refresh data
      queryClient.invalidateQueries({ queryKey: ['intelligence-patterns'] });
      queryClient.invalidateQueries({ queryKey: ['intelligence-stats'] });
    }

    if (lastMessage.type === 'intelligence:stats_update') {
      // Invalidate stats query to refresh with new data
      queryClient.invalidateQueries({ queryKey: ['intelligence-stats'] });
    }
  }, [lastMessage, queryClient]);

  // Use default stats if API returns empty
  const stats = statsData?.data ?? DEFAULT_STATS;
  const patterns = patternsData?.data ?? [];
  const reconstructions = reconstructionsData?.data ?? [];

  return (
    <PageLayout title="Intelligence Platform">
      <Section
        description="AI-powered incident reconstruction and pattern learning"
      >
        {/* Stats - always show with fallback to default stats */}
        <StatsCard stats={stats} />

        {/* Tabs */}
        <div className="flex items-center gap-2 mt-6 mb-4">
          <button
            onClick={() => setActiveTab('patterns')}
            className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors flex items-center gap-2 ${
              activeTab === 'patterns'
                ? 'bg-purple-600 text-white'
                : 'bg-gray-800 text-gray-400 hover:text-white'
            }`}
          >
            <Brain size={16} />
            Learned Patterns
            <span className="px-1.5 py-0.5 text-xs bg-black/20 rounded">
              {patterns.length}
            </span>
          </button>
          <button
            onClick={() => setActiveTab('reconstructions')}
            className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors flex items-center gap-2 ${
              activeTab === 'reconstructions'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-800 text-gray-400 hover:text-white'
            }`}
          >
            <Clock size={16} />
            Incident Reconstructions
            <span className="px-1.5 py-0.5 text-xs bg-black/20 rounded">
              {reconstructions.length}
            </span>
          </button>
        </div>

        {/* Patterns Tab */}
        {activeTab === 'patterns' && (
          <>
            {patternsLoading && (
              <div className="py-12 text-center text-gray-500">
                <div className="animate-spin h-8 w-8 border-2 border-purple-500 border-t-transparent rounded-full mx-auto mb-4" />
                <p>Loading patterns...</p>
              </div>
            )}

            {patternsError && (
              <Card>
                <div className="py-8 text-center text-red-500">
                  <AlertTriangle size={48} className="mx-auto mb-3 opacity-50" />
                  <p>Failed to load patterns</p>
                </div>
              </Card>
            )}

            {!patternsLoading && !patternsError && (
              <PatternLibrary patterns={patterns} />
            )}
          </>
        )}

        {/* Reconstructions Tab */}
        {activeTab === 'reconstructions' && (
          <>
            {reconstructionsLoading && (
              <div className="py-12 text-center text-gray-500">
                <div className="animate-spin h-8 w-8 border-2 border-blue-500 border-t-transparent rounded-full mx-auto mb-4" />
                <p>Loading reconstructions...</p>
              </div>
            )}

            {reconstructionsError && (
              <Card>
                <div className="py-8 text-center text-red-500">
                  <AlertTriangle size={48} className="mx-auto mb-3 opacity-50" />
                  <p>Failed to load reconstructions</p>
                </div>
              </Card>
            )}

            {!reconstructionsLoading && !reconstructionsError && reconstructions.length === 0 && (
              <Card>
                <div className="py-12 text-center text-gray-500">
                  <Inbox size={48} className="mx-auto mb-4 opacity-50" />
                  <p>No incident reconstructions</p>
                  <p className="text-sm text-gray-600 mt-2">
                    Reconstructions are created from raw incident data
                  </p>
                </div>
              </Card>
            )}

            {!reconstructionsLoading && !reconstructionsError && reconstructions.length > 0 && (
              <Card padding="none">
                <div className="px-4 py-2 border-b border-gray-700 bg-gray-800/50">
                  <div className="flex items-center text-xs text-gray-500 font-medium">
                    <span className="flex-1">Root Cause</span>
                    <span className="w-32 text-right">Created</span>
                  </div>
                </div>
                {reconstructions.map((reconstruction) => (
                  <ReconstructionRow key={reconstruction.id} reconstruction={reconstruction} />
                ))}
              </Card>
            )}
          </>
        )}
      </Section>
    </PageLayout>
  );
}
