/**
 * React Query hooks for Edit Locks, Evolutions, Git, and File Versions
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef } from 'react';
import { editLocksApi, type AcquireLockRequest } from '../api/edit-locks';
import { evolutionsApi, type CreateEvolutionRequest } from '../api/evolutions';
import { gitApi } from '../api/git';
import { fileVersionsApi } from '../api/file-versions';
import { ApiError } from '../api/client';

// ============================================
// Edit Lock Hooks
// ============================================

/**
 * Hook to get lock status for a development cycle
 */
export function useLockInfo(cycleId: string | undefined, userId: string) {
  return useQuery({
    queryKey: ['lock-info', cycleId, userId],
    queryFn: () => editLocksApi.getLockInfo(cycleId!, userId),
    enabled: !!cycleId && !!userId,
    refetchInterval: 10000, // Check every 10 seconds
  });
}

/**
 * Hook to acquire a lock
 */
export function useAcquireLock(cycleId: string | undefined) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: AcquireLockRequest) => editLocksApi.acquireLock(cycleId!, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lock-info', cycleId] });
    },
  });
}

/**
 * Hook to release a lock
 */
export function useReleaseLock(cycleId: string | undefined) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ lockId, userId }: { lockId: string; userId: string }) =>
      editLocksApi.releaseLock(cycleId!, lockId, { userId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lock-info', cycleId] });
    },
  });
}

/**
 * Hook to manage lock heartbeat automatically
 */
export function useLockHeartbeat(
  cycleId: string | undefined,
  lockId: string | undefined,
  userId: string,
  isActive: boolean
) {
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const heartbeatMutation = useMutation({
    mutationFn: () => editLocksApi.heartbeat(cycleId!, lockId!, { userId }),
  });

  useEffect(() => {
    if (!isActive || !cycleId || !lockId || !userId) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }

    // Send heartbeat every 60 seconds
    intervalRef.current = setInterval(() => {
      heartbeatMutation.mutate();
    }, 60000);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [cycleId, lockId, userId, isActive, heartbeatMutation]);

  return heartbeatMutation;
}

/**
 * Hook to save local backup before lock expires
 */
export function useSaveBackup(cycleId: string | undefined) {
  return useMutation({
    mutationFn: ({ lockId, changes }: { lockId: string; changes: Record<string, string> }) =>
      editLocksApi.saveBackup(cycleId!, lockId, { changes }),
  });
}

/**
 * Hook to update a file with lock validation
 */
export function useUpdateFile(cycleId: string | undefined) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ fileId, content, userId }: { fileId: string; content: string; userId: string }) =>
      editLocksApi.updateFile(cycleId!, fileId, { content, userId }),
    onSuccess: (_, { fileId }) => {
      queryClient.invalidateQueries({ queryKey: ['development-files', cycleId] });
      queryClient.invalidateQueries({ queryKey: ['file-versions', cycleId, fileId] });
    },
  });
}

// ============================================
// Evolution Hooks
// ============================================

/**
 * Hook to list evolutions for a development cycle
 */
export function useEvolutions(cycleId: string | undefined) {
  return useQuery({
    queryKey: ['evolutions', cycleId],
    queryFn: () => evolutionsApi.list(cycleId!),
    enabled: !!cycleId,
    refetchInterval: 5000, // Poll for status updates
  });
}

/**
 * Hook to get a specific evolution
 */
export function useEvolution(cycleId: string | undefined, evolutionId: string | undefined) {
  return useQuery({
    queryKey: ['evolution', cycleId, evolutionId],
    queryFn: () => evolutionsApi.get(cycleId!, evolutionId!),
    enabled: !!cycleId && !!evolutionId,
    refetchInterval: 3000, // Poll more frequently for active evolutions
  });
}

/**
 * Hook to create a new evolution
 */
export function useCreateEvolution(cycleId: string | undefined) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateEvolutionRequest) => evolutionsApi.create(cycleId!, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['evolutions', cycleId] });
    },
  });
}

/**
 * Hook to analyze an evolution
 */
export function useAnalyzeEvolution(cycleId: string | undefined) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (evolutionId: string) => evolutionsApi.analyze(cycleId!, evolutionId),
    onSuccess: (_, evolutionId) => {
      queryClient.invalidateQueries({ queryKey: ['evolution', cycleId, evolutionId] });
      queryClient.invalidateQueries({ queryKey: ['evolutions', cycleId] });
    },
  });
}

/**
 * Hook to generate changes for an evolution
 */
export function useGenerateEvolution(cycleId: string | undefined) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (evolutionId: string) => evolutionsApi.generate(cycleId!, evolutionId),
    onSuccess: (_, evolutionId) => {
      queryClient.invalidateQueries({ queryKey: ['evolution', cycleId, evolutionId] });
      queryClient.invalidateQueries({ queryKey: ['evolutions', cycleId] });
    },
  });
}

/**
 * Hook to approve an evolution
 */
export function useApproveEvolution(cycleId: string | undefined) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      evolutionId,
      reviewedBy,
      notes,
    }: { evolutionId: string; reviewedBy: string; notes?: string }) =>
      evolutionsApi.approve(cycleId!, evolutionId, { reviewedBy, notes }),
    onSuccess: (_, { evolutionId }) => {
      queryClient.invalidateQueries({ queryKey: ['evolution', cycleId, evolutionId] });
      queryClient.invalidateQueries({ queryKey: ['evolutions', cycleId] });
    },
  });
}

/**
 * Hook to reject an evolution
 */
export function useRejectEvolution(cycleId: string | undefined) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      evolutionId,
      reviewedBy,
      notes,
    }: { evolutionId: string; reviewedBy: string; notes?: string }) =>
      evolutionsApi.reject(cycleId!, evolutionId, { reviewedBy, notes }),
    onSuccess: (_, { evolutionId }) => {
      queryClient.invalidateQueries({ queryKey: ['evolution', cycleId, evolutionId] });
      queryClient.invalidateQueries({ queryKey: ['evolutions', cycleId] });
    },
  });
}

/**
 * Hook to apply an evolution
 */
export function useApplyEvolution(cycleId: string | undefined) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ evolutionId, approvedBy }: { evolutionId: string; approvedBy: string }) => 
      evolutionsApi.apply(cycleId!, evolutionId, approvedBy),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['evolutions', cycleId] });
      queryClient.invalidateQueries({ queryKey: ['development-files', cycleId] });
      queryClient.invalidateQueries({ queryKey: ['development-cycle', cycleId] });
    },
  });
}

/**
 * Hook to revert an evolution
 */
export function useRevertEvolution(cycleId: string | undefined) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ evolutionId, reason }: { evolutionId: string; reason: string }) =>
      evolutionsApi.revert(cycleId!, evolutionId, reason),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['evolutions', cycleId] });
      queryClient.invalidateQueries({ queryKey: ['development-files', cycleId] });
    },
  });
}

/**
 * Hook to cancel an evolution
 */
export function useCancelEvolution(cycleId: string | undefined) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (evolutionId: string) => evolutionsApi.cancel(cycleId!, evolutionId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['evolutions', cycleId] });
    },
  });
}

// ============================================
// Git Hooks
// ============================================

/**
 * Hook to get global git status
 */
export function useGitGlobalStatus() {
  return useQuery({
    queryKey: ['git-global-status'],
    queryFn: () => gitApi.getGlobalStatus(),
  });
}

/**
 * Hook to get git status for a development cycle
 */
export function useGitStatus(cycleId: string | undefined) {
  return useQuery({
    queryKey: ['git-status', cycleId],
    queryFn: async () => {
      try {
        return await gitApi.getStatus(cycleId!);
      } catch (error) {
        // If git repo doesn't exist, return null instead of throwing
        if (error instanceof ApiError && error.isNotFound) {
          return null;
        }
        throw error;
      }
    },
    enabled: !!cycleId,
    // Only refetch if we got a successful response (not null)
    refetchInterval: (query) => (query.state.data ? 10000 : false),
    retry: (failureCount, error) => {
      // Don't retry on 404 (git repo not initialized)
      if (error instanceof ApiError && error.isNotFound) {
        return false;
      }
      return failureCount < 3;
    },
  });
}

/**
 * Hook to initialize git repository
 */
export function useInitGitRepo(cycleId: string | undefined) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (options?: { createGitHub?: boolean; repoName?: string }) =>
      gitApi.initRepo(cycleId!, options),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['git-status', cycleId] });
    },
  });
}

/**
 * Hook to commit changes
 */
export function useGitCommit(cycleId: string | undefined) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (message: string) => gitApi.commit(cycleId!, message),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['git-status', cycleId] });
      queryClient.invalidateQueries({ queryKey: ['git-history', cycleId] });
    },
  });
}

/**
 * Hook to push changes
 */
export function useGitPush(cycleId: string | undefined) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => gitApi.push(cycleId!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['git-status', cycleId] });
    },
  });
}

/**
 * Hook to get commit history
 */
export function useGitHistory(cycleId: string | undefined, limit?: number) {
  return useQuery({
    queryKey: ['git-history', cycleId, limit],
    queryFn: () => gitApi.getHistory(cycleId!, limit),
    enabled: !!cycleId,
  });
}

/**
 * Hook to get diff
 */
export function useGitDiff(cycleId: string | undefined, filePath?: string) {
  return useQuery({
    queryKey: ['git-diff', cycleId, filePath],
    queryFn: () => gitApi.getDiff(cycleId!, filePath),
    enabled: !!cycleId,
  });
}

/**
 * Hook to revert to a commit
 */
export function useGitRevert(cycleId: string | undefined) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (commitHash: string) => gitApi.revert(cycleId!, commitHash),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['git-status', cycleId] });
      queryClient.invalidateQueries({ queryKey: ['git-history', cycleId] });
      queryClient.invalidateQueries({ queryKey: ['development-files', cycleId] });
    },
  });
}

// ============================================
// File Version Hooks
// ============================================

/**
 * Hook to get version history for a file
 */
export function useFileVersions(cycleId: string | undefined, fileId: string | undefined) {
  return useQuery({
    queryKey: ['file-versions', cycleId, fileId],
    queryFn: () => fileVersionsApi.getFileVersions(cycleId!, fileId!),
    enabled: !!cycleId && !!fileId,
  });
}

/**
 * Hook to get all versions for a cycle
 */
export function useCycleVersions(cycleId: string | undefined) {
  return useQuery({
    queryKey: ['cycle-versions', cycleId],
    queryFn: () => fileVersionsApi.getCycleVersions(cycleId!),
    enabled: !!cycleId,
  });
}

/**
 * Hook to restore a file version
 */
export function useRestoreVersion(cycleId: string | undefined) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      fileId,
      versionId,
      userId,
    }: {
      fileId: string;
      versionId: string;
      userId: string;
    }) => fileVersionsApi.restoreVersion(cycleId!, fileId, versionId, userId),
    onSuccess: (_, { fileId }) => {
      queryClient.invalidateQueries({ queryKey: ['file-versions', cycleId, fileId] });
      queryClient.invalidateQueries({ queryKey: ['development-files', cycleId] });
    },
  });
}

/**
 * Hook to compare two versions
 */
export function useCompareVersions(
  cycleId: string | undefined,
  fileId: string | undefined,
  fromVersionId: string | undefined,
  toVersionId: string | undefined
) {
  return useQuery({
    queryKey: ['version-compare', cycleId, fileId, fromVersionId, toVersionId],
    queryFn: () =>
      fileVersionsApi.compareVersions(cycleId!, fileId!, fromVersionId!, toVersionId!),
    enabled: !!cycleId && !!fileId && !!fromVersionId && !!toVersionId,
  });
}

// ============================================
// User ID Management
// ============================================

/**
 * Hook to get/generate a persistent user ID
 */
export function useUserId(): string {
  const storageKey = 'chronosops-user-id';

  const getUserId = useCallback(() => {
    let userId = localStorage.getItem(storageKey);
    if (!userId) {
      userId = `user-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
      localStorage.setItem(storageKey, userId);
    }
    return userId;
  }, []);

  return getUserId();
}
