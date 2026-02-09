/**
 * PostmortemPage - Display full postmortem report for a resolved incident
 */
import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { formatDistanceToNow, format } from 'date-fns';
import { FileText, ArrowLeft, ExternalLink } from 'lucide-react';
import { incidentsApi } from '../api/incidents';
import { PageLayout, Section, Card } from '../components/layout/PageLayout';

export function PostmortemPage() {
  const { id } = useParams<{ id: string }>();

  // Fetch incident details
  const { data: incidentData, isLoading: isLoadingIncident } = useQuery({
    queryKey: ['incident', id],
    queryFn: () => incidentsApi.get(id!),
    enabled: !!id,
  });

  // Fetch postmortem
  const { data: postmortemData, isLoading: isLoadingPostmortem, error } = useQuery({
    queryKey: ['postmortem', id],
    queryFn: () => incidentsApi.getPostmortem(id!),
    enabled: !!id,
  });

  const incident = incidentData?.data;
  const postmortem = postmortemData?.data;

  if (isLoadingIncident || isLoadingPostmortem) {
    return (
      <PageLayout title="Postmortem Report">
        <Section>
          <Card>
            <div className="text-center py-12 text-gray-500">
              <div className="text-4xl mb-4 animate-pulse">...</div>
              <p>Loading postmortem...</p>
            </div>
          </Card>
        </Section>
      </PageLayout>
    );
  }

  if (error || !postmortem) {
    return (
      <PageLayout title="Postmortem Report">
        <Section>
          <Card>
            <div className="text-center py-12 text-gray-500">
              <FileText size={48} className="mx-auto mb-4 opacity-50" />
              <p>No postmortem available for this incident</p>
              <p className="text-sm text-gray-600 mt-2">
                Postmortems are generated automatically when investigations complete successfully.
              </p>
              <Link
                to={`/incidents/${id}`}
                className="inline-block mt-4 px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded transition-colors"
              >
                Back to Incident
              </Link>
            </div>
          </Card>
        </Section>
      </PageLayout>
    );
  }

  const severityColors: Record<string, string> = {
    critical: 'bg-red-500/20 text-red-400 border-red-500/30',
    high: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
    medium: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
    low: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  };

  return (
    <PageLayout title="Postmortem Report">
      {/* Header Card */}
      <Card>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3 mb-2 flex-wrap">
              <h2 className="text-xl font-semibold truncate">{incident?.title || 'Incident'}</h2>
              {incident?.severity && (
                <span className={`px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wide rounded-full border ${severityColors[incident.severity]}`}>
                  {incident.severity}
                </span>
              )}
            </div>
            <div className="text-sm text-gray-400">
              {incident && (
                <span>
                  Namespace: <span className="text-cyan-400">{incident.namespace}</span>
                  {' · '}Started {format(new Date(incident.startedAt), 'PPp')}
                  {' · '}
                </span>
              )}
              Postmortem generated {formatDistanceToNow(new Date(postmortem.createdAt), { addSuffix: true })}
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <Link
              to={`/incidents/${id}`}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-cyan-300 bg-cyan-500/10 hover:bg-cyan-500/20 border border-cyan-500/30 rounded-lg transition-colors"
            >
              <ExternalLink size={14} />
              View Incident
            </Link>
            <Link
              to="/history"
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-300 bg-gray-700/50 hover:bg-gray-600/50 border border-gray-600/50 rounded-lg transition-colors"
            >
              <ArrowLeft size={14} />
              Back to History
            </Link>
          </div>
        </div>
      </Card>

      {/* Executive Summary */}
      <Section title="Executive Summary">
        <Card>
          <p className="text-gray-300 leading-relaxed">{postmortem.summary}</p>
        </Card>
      </Section>

      {/* Timeline */}
      {postmortem.timeline && postmortem.timeline.length > 0 && (
        <Section title="Timeline of Events">
          <Card>
            <div className="space-y-3">
              {(Array.isArray(postmortem.timeline) ? postmortem.timeline : []).map((event, index) => (
                <div key={index} className="flex items-start gap-4 pb-3 border-b border-gray-700 last:border-0 last:pb-0">
                  <div className="flex-shrink-0 w-8 h-8 rounded-full bg-gray-700 flex items-center justify-center text-sm text-gray-400">
                    {index + 1}
                  </div>
                  <div className="flex-1">
                    <p className="text-gray-300">{event}</p>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </Section>
      )}

      {/* Root Cause Analysis */}
      <Section title="Root Cause Analysis">
        <Card>
          <p className="text-gray-300 leading-relaxed whitespace-pre-wrap">{postmortem.rootCauseAnalysis}</p>
        </Card>
      </Section>

      {/* Impact Analysis */}
      <Section title="Impact Analysis">
        <Card>
          <p className="text-gray-300 leading-relaxed whitespace-pre-wrap">{postmortem.impactAnalysis}</p>
        </Card>
      </Section>

      {/* Actions Taken */}
      {postmortem.actionsTaken && postmortem.actionsTaken.length > 0 && (
        <Section title="Actions Taken">
          <Card>
            <div className="space-y-3">
              {postmortem.actionsTaken.map((action, index) => (
                <div key={index} className="p-3 bg-gray-700/50 rounded-lg">
                  <span className="text-gray-200">{action}</span>
                </div>
              ))}
            </div>
          </Card>
        </Section>
      )}

      {/* Lessons Learned */}
      {postmortem.lessonsLearned && postmortem.lessonsLearned.length > 0 && (
        <Section title="Lessons Learned">
          <Card>
            <ul className="space-y-2">
              {postmortem.lessonsLearned.map((lesson, index) => (
                <li key={index} className="flex items-start gap-3 text-gray-300">
                  <span className="text-yellow-400 mt-1">-</span>
                  <span>{lesson}</span>
                </li>
              ))}
            </ul>
          </Card>
        </Section>
      )}

      {/* Prevention Recommendations */}
      {postmortem.preventionRecommendations && postmortem.preventionRecommendations.length > 0 && (
        <Section title="Prevention Recommendations">
          <Card>
            <ul className="space-y-2">
              {postmortem.preventionRecommendations.map((rec, index) => (
                <li key={index} className="flex items-start gap-3 text-gray-300">
                  <span className="text-blue-400 mt-1">-</span>
                  <span>{rec}</span>
                </li>
              ))}
            </ul>
          </Card>
        </Section>
      )}

      {/* Full Markdown Report */}
      {postmortem.markdown && (
        <Section title="Full Report (Markdown)">
          <Card>
            <details className="group">
              <summary className="cursor-pointer text-gray-400 hover:text-gray-300 transition-colors">
                Click to expand full markdown report
              </summary>
              <pre className="mt-4 p-4 bg-gray-900 rounded-lg overflow-x-auto text-sm text-gray-300 whitespace-pre-wrap">
                {postmortem.markdown}
              </pre>
            </details>
          </Card>
        </Section>
      )}
    </PageLayout>
  );
}
