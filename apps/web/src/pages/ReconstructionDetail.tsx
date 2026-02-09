/**
 * ReconstructionDetail - Detailed view of an incident reconstruction
 */
import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import {
  ArrowLeft,
  Clock,
  AlertTriangle,
  Target,
  Lightbulb,
  BarChart3,
} from 'lucide-react';
import { PageLayout, Section, Card, Grid } from '../components/layout/PageLayout';
import { TimelineViewer } from '../components/intelligence/TimelineViewer';
import { CausalChainGraph } from '../components/intelligence/CausalChainGraph';
import { intelligenceApi } from '../api/intelligence';
import { config } from '../config/env';

export function ReconstructionDetail() {
  const { id } = useParams<{ id: string }>();

  const { data, isLoading, error } = useQuery({
    queryKey: ['intelligence-reconstruction', id],
    queryFn: () => intelligenceApi.getReconstruction(id!),
    enabled: !!id,
    refetchInterval: config.polling.incidentRefresh,
  });

  const reconstruction = data?.data;

  if (isLoading) {
    return (
      <PageLayout>
        <div className="py-12 text-center text-gray-500">
          <div className="animate-spin h-8 w-8 border-2 border-blue-500 border-t-transparent rounded-full mx-auto mb-4" />
          <p>Loading reconstruction...</p>
        </div>
      </PageLayout>
    );
  }

  if (error || !reconstruction) {
    return (
      <PageLayout>
        <div className="py-12 text-center text-red-500">
          <AlertTriangle size={48} className="mx-auto mb-3 opacity-50" />
          <p>Failed to load reconstruction</p>
          <Link to="/intelligence" className="mt-4 text-blue-400 hover:underline">
            Back to Intelligence Platform
          </Link>
        </div>
      </PageLayout>
    );
  }

  return (
    <PageLayout>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4">
          <Link
            to="/intelligence"
            className="p-2 rounded-lg hover:bg-gray-800 transition-colors"
          >
            <ArrowLeft size={20} className="text-gray-400" />
          </Link>
          <div>
            <h1 className="text-xl font-bold text-white">Incident Reconstruction</h1>
            <p className="text-sm text-gray-500">{reconstruction.id}</p>
          </div>
        </div>
        <div className="text-right text-sm text-gray-500">
          <div className="flex items-center gap-1">
            <Clock size={14} />
            {format(new Date(reconstruction.timeRangeStart), 'PPp')} - {format(new Date(reconstruction.timeRangeEnd), 'PPp')}
          </div>
        </div>
      </div>

      {/* Root Cause */}
      <Section>
        <Card className="border-red-500/30 bg-red-500/5">
          <div className="flex items-start gap-3">
            <Target className="text-red-400 flex-shrink-0 mt-0.5" size={20} />
            <div>
              <h3 className="text-sm font-medium text-red-400">Root Cause</h3>
              <p className="text-white mt-1">{reconstruction.rootCause}</p>
            </div>
          </div>
        </Card>
      </Section>

      {/* Narrative */}
      <Section>
        <Card>
          <div className="flex items-start gap-3">
            <Lightbulb className="text-yellow-400 flex-shrink-0 mt-0.5" size={20} />
            <div>
              <h3 className="text-sm font-medium text-gray-300 mb-2">Narrative</h3>
              <p className="text-gray-400 text-sm whitespace-pre-wrap">{reconstruction.narrative}</p>
            </div>
          </div>
        </Card>
      </Section>

      {/* Data Quality */}
      <Section>
        <Card>
          <div className="flex items-center gap-2 mb-4">
            <BarChart3 size={18} className="text-blue-400" />
            <h3 className="text-sm font-medium text-gray-300">Data Quality</h3>
          </div>
          <Grid cols={2} gap="sm">
            <div className="p-3 bg-gray-900/50 rounded">
              <div className="text-xs text-gray-500 mb-1">Confidence Score</div>
              <div className="flex items-center gap-2">
                <div className="flex-1 h-2 bg-gray-700 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-blue-500"
                    style={{ width: `${((reconstruction.dataQuality as { confidenceScore?: number })?.confidenceScore ?? (reconstruction.dataQuality as { completeness?: number })?.completeness ?? 0) * 100}%` }}
                  />
                </div>
                <span className="text-sm text-blue-400">
                  {Math.round(((reconstruction.dataQuality as { confidenceScore?: number })?.confidenceScore ?? (reconstruction.dataQuality as { completeness?: number })?.completeness ?? 0) * 100)}%
                </span>
              </div>
            </div>
            <div className="p-3 bg-gray-900/50 rounded">
              <div className="text-xs text-gray-500 mb-1">Data Sources</div>
              <div className="flex items-center gap-2 text-sm flex-wrap">
                <span className={`px-2 py-0.5 rounded text-xs ${(reconstruction.dataQuality as { logsAvailable?: boolean })?.logsAvailable ? 'bg-green-500/20 text-green-400' : 'bg-gray-700 text-gray-500'}`}>
                  Logs
                </span>
                <span className={`px-2 py-0.5 rounded text-xs ${(reconstruction.dataQuality as { metricsAvailable?: boolean })?.metricsAvailable ? 'bg-green-500/20 text-green-400' : 'bg-gray-700 text-gray-500'}`}>
                  Metrics
                </span>
                <span className={`px-2 py-0.5 rounded text-xs ${(reconstruction.dataQuality as { eventsAvailable?: boolean })?.eventsAvailable ? 'bg-green-500/20 text-green-400' : 'bg-gray-700 text-gray-500'}`}>
                  Events
                </span>
                <span className={`px-2 py-0.5 rounded text-xs ${(reconstruction.dataQuality as { screenshotsAvailable?: boolean })?.screenshotsAvailable ? 'bg-purple-500/20 text-purple-400' : 'bg-gray-700 text-gray-500'}`}>
                  Screenshots
                </span>
              </div>
            </div>
          </Grid>
          {(reconstruction.dataQuality?.gaps?.length ?? 0) > 0 && (
            <div className="mt-4">
              <div className="text-xs font-medium text-gray-400 mb-2">Data Gaps</div>
              <ul className="text-xs text-gray-500 space-y-1">
                {reconstruction.dataQuality.gaps.map((gap, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <AlertTriangle size={12} className="text-yellow-400 mt-0.5 flex-shrink-0" />
                    {gap}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>
      </Section>

      {/* Recommendations */}
      {(reconstruction.recommendations?.length ?? 0) > 0 && (
        <Section>
          <Card>
            <h3 className="text-sm font-medium text-gray-300 mb-3">Recommendations</h3>
            <ul className="space-y-2">
              {reconstruction.recommendations.map((rec, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-gray-400">
                  <span className="text-green-400 font-medium">{i + 1}.</span>
                  {typeof rec === 'string' ? rec : (rec as { action?: string; rationale?: string })?.action ?? JSON.stringify(rec)}
                </li>
              ))}
            </ul>
          </Card>
        </Section>
      )}

      {/* Timeline */}
      {(reconstruction.timeline?.length ?? 0) > 0 && (
        <Section>
          <TimelineViewer entries={reconstruction.timeline} />
        </Section>
      )}

      {/* Causal Chain */}
      {(reconstruction.causalChain?.length ?? 0) > 0 && (
        <Section>
          <CausalChainGraph
            links={reconstruction.causalChain}
            rootCause={reconstruction.rootCause}
          />
        </Section>
      )}

      {/* Token Usage */}
      {reconstruction.inputTokensUsed != null && (
        <Section>
          <div className="text-right text-xs text-gray-500">
            Analysis used {reconstruction.inputTokensUsed.toLocaleString()} tokens
          </div>
        </Section>
      )}
    </PageLayout>
  );
}
