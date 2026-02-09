/**
 * Main App component with React Router, keyboard shortcuts, and animations
 */
import { useState, useMemo } from 'react';
import { Routes, Route, useNavigate } from 'react-router-dom';
import { CommandCenter } from './pages/CommandCenter';
import { IncidentList } from './pages/IncidentList';
import { InvestigationView } from './pages/InvestigationView';
import { Setup } from './pages/Setup';
import { History } from './pages/History';
import { PostmortemPage } from './pages/PostmortemPage';
import { DevelopmentDashboard } from './pages/DevelopmentDashboard';
import { DevelopmentDetail } from './pages/DevelopmentDetail';
import { EvolutionDetail } from './pages/EvolutionDetail';
import { IntelligencePlatform } from './pages/IntelligencePlatform';
import { ReconstructionDetail } from './pages/ReconstructionDetail';
import { RouteErrorBoundary, CommandCenterError, InvestigationError } from './components/common/RouteErrorBoundary';
import { CreateIncidentModal } from './components/forms/CreateIncidentModal';
import { KeyboardShortcutsHelp } from './components/common/KeyboardShortcutsHelp';
import { useKeyboardShortcuts, useShortcutsHelp, type KeyboardShortcut } from './hooks';

export default function App() {
  const navigate = useNavigate();
  const [showCreateModal, setShowCreateModal] = useState(false);
  const { isOpen: showShortcutsHelp, open: openShortcutsHelp, close: closeShortcutsHelp } = useShortcutsHelp();

  // Define keyboard shortcuts
  const shortcuts = useMemo<KeyboardShortcut[]>(() => [
    {
      key: 'g',
      handler: () => navigate('/'),
      description: 'Go to Command Center',
      category: 'Navigation',
    },
    {
      key: 'i',
      handler: () => navigate('/incidents'),
      description: 'Go to Incidents',
      category: 'Navigation',
    },
    {
      key: 's',
      handler: () => navigate('/setup'),
      description: 'Go to Setup',
      category: 'Navigation',
    },
    {
      key: 'h',
      handler: () => navigate('/history'),
      description: 'Go to History',
      category: 'Navigation',
    },
    {
      key: 'd',
      handler: () => navigate('/development'),
      description: 'Go to Development',
      category: 'Navigation',
    },
    {
      key: 'l',
      handler: () => navigate('/intelligence'),
      description: 'Go to Intelligence',
      category: 'Navigation',
    },
    {
      key: 'c',
      handler: () => setShowCreateModal(true),
      description: 'Create new incident',
      category: 'Actions',
    },
    {
      key: '?',
      shift: true,
      handler: openShortcutsHelp,
      description: 'Show keyboard shortcuts',
      category: 'Help',
    },
    {
      key: 'Escape',
      handler: () => {
        setShowCreateModal(false);
        closeShortcutsHelp();
      },
      description: 'Close modal',
      category: 'General',
    },
  ], [navigate, openShortcutsHelp, closeShortcutsHelp]);

  // Enable keyboard shortcuts
  useKeyboardShortcuts(shortcuts);

  return (
    <>
      <Routes>
          <Route
            path="/"
            element={
              <RouteErrorBoundary fallback={<CommandCenterError />}>
                <CommandCenter onCreateIncident={() => setShowCreateModal(true)} />
              </RouteErrorBoundary>
            }
          />
          <Route
            path="/incidents"
            element={
              <RouteErrorBoundary>
                <IncidentList />
              </RouteErrorBoundary>
            }
          />
          <Route
            path="/incidents/:id"
            element={
              <RouteErrorBoundary fallback={<InvestigationError />}>
                <InvestigationView />
              </RouteErrorBoundary>
            }
          />
          <Route
            path="/setup"
            element={
              <RouteErrorBoundary>
                <Setup />
              </RouteErrorBoundary>
            }
          />
          <Route
            path="/setup/*"
            element={
              <RouteErrorBoundary>
                <Setup />
              </RouteErrorBoundary>
            }
          />
          <Route
            path="/history"
            element={
              <RouteErrorBoundary>
                <History />
              </RouteErrorBoundary>
            }
          />
          <Route
            path="/history/:id/postmortem"
            element={
              <RouteErrorBoundary>
                <PostmortemPage />
              </RouteErrorBoundary>
            }
          />
          <Route
            path="/development"
            element={
              <RouteErrorBoundary>
                <DevelopmentDashboard />
              </RouteErrorBoundary>
            }
          />
          <Route
            path="/development/:id"
            element={
              <RouteErrorBoundary>
                <DevelopmentDetail />
              </RouteErrorBoundary>
            }
          />
          <Route
            path="/development/:id/evolution/:evolutionId"
            element={
              <RouteErrorBoundary>
                <EvolutionDetail />
              </RouteErrorBoundary>
            }
          />
          <Route
            path="/intelligence"
            element={
              <RouteErrorBoundary>
                <IntelligencePlatform />
              </RouteErrorBoundary>
            }
          />
          <Route
            path="/intelligence/reconstructions/:id"
            element={
              <RouteErrorBoundary>
                <ReconstructionDetail />
              </RouteErrorBoundary>
            }
          />
          {/* Fallback route */}
          <Route
            path="*"
            element={
              <div className="min-h-screen bg-gray-900 text-white flex items-center justify-center">
                <div className="text-center">
                  <div className="text-6xl mb-4">404</div>
                  <h2 className="text-xl font-semibold mb-2">Page Not Found</h2>
                  <a href="/" className="text-blue-400 hover:underline">
                    Back to Command Center
                  </a>
                </div>
              </div>
            }
          />
      </Routes>

      {/* Global modals */}
      <CreateIncidentModal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
      />

      <KeyboardShortcutsHelp
        isOpen={showShortcutsHelp}
        onClose={closeShortcutsHelp}
        shortcuts={shortcuts}
      />
    </>
  );
}
