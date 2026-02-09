/**
 * Code Evolution Engine
 * AI-powered code evolution with:
 * - 10-file limit per evolution
 * - Analysis, generation, review workflow
 * - Auto-revert on deployment failure
 */

import { createLogger, Logger, getConfig } from '@chronosops/shared';
import {
  CodeEvolutionRepository,
  CodeEvolutionRecord,
  GeneratedFileRepository,
  GeneratedFileRecord,
  FileVersionRepository,
  EvolutionAnalysisResult,
  ProposedChange,
} from '@chronosops/database';
import { GeminiClient } from '@chronosops/gemini';
import { GitService } from '@chronosops/git';

export interface EvolutionEngineOptions {
  evolutionRepository?: CodeEvolutionRepository;
  fileRepository?: GeneratedFileRepository;
  versionRepository?: FileVersionRepository;
  geminiClient?: GeminiClient;
  gitService?: GitService;
  logger?: Logger;
}

export interface RequestEvolutionInput {
  developmentCycleId: string;
  prompt: string;
  scope?: string[]; // Specific files to evolve, or null for AI to decide
  requestedBy?: string;
}

export interface EvolutionRequestResult {
  success: boolean;
  evolution?: CodeEvolutionRecord;
  error?: string;
  requiresConfirmation?: boolean;
  confirmationReason?: string;
}

export interface AnalyzeEvolutionResult {
  success: boolean;
  evolution?: CodeEvolutionRecord;
  analysis?: EvolutionAnalysisResult;
  error?: string;
  exceedsLimit?: boolean;
}

export interface GenerateEvolutionResult {
  success: boolean;
  evolution?: CodeEvolutionRecord;
  changes?: ProposedChange[];
  error?: string;
}

export interface ApplyEvolutionResult {
  success: boolean;
  evolution?: CodeEvolutionRecord;
  filesUpdated?: number;
  error?: string;
  /**
   * Set to true when evolution requires human approval
   * Only returned when CODE_EVOLUTION_AUTO_APPROVE=false
   */
  awaitingApproval?: boolean;
}

export interface RevertEvolutionResult {
  success: boolean;
  evolution?: CodeEvolutionRecord;
  filesReverted?: number;
  error?: string;
}

export class CodeEvolutionEngine {
  private readonly evolutionRepository: CodeEvolutionRepository;
  private readonly fileRepository: GeneratedFileRepository;
  private readonly versionRepository: FileVersionRepository;
  private readonly geminiClient: GeminiClient;
  private readonly gitService?: GitService;
  private readonly logger: Logger;
  private readonly config: ReturnType<typeof getConfig>['evolution'];

  constructor(options: EvolutionEngineOptions = {}) {
    this.evolutionRepository = options.evolutionRepository ?? new CodeEvolutionRepository();
    this.fileRepository = options.fileRepository ?? new GeneratedFileRepository();
    this.versionRepository = options.versionRepository ?? new FileVersionRepository();
    const config = getConfig();
    this.geminiClient = options.geminiClient ?? new GeminiClient({
      apiKey: config.gemini.apiKey,
      model: config.gemini.model as import('@chronosops/gemini').GeminiModel,
      proModel: config.gemini.proModel as import('@chronosops/gemini').GeminiModel,
      modelAssignments: config.gemini.modelAssignments,
    });
    this.gitService = options.gitService;
    this.logger = options.logger ?? createLogger('CodeEvolutionEngine');
    this.config = config.evolution;
  }

  /**
   * Request a new code evolution
   */
  async requestEvolution(input: RequestEvolutionInput): Promise<EvolutionRequestResult> {
    const { developmentCycleId, prompt, scope } = input;

    this.logger.info({ developmentCycleId, prompt: prompt.substring(0, 100) }, 'Evolution requested');

    try {
      // Check pending evolution count
      const pendingCount = await this.evolutionRepository.countPendingByCycleId(developmentCycleId);
      if (pendingCount >= this.config.maxPendingEvolutions) {
        return {
          success: false,
          error: `Maximum pending evolutions (${this.config.maxPendingEvolutions}) reached. Please complete or cancel existing evolutions first.`,
        };
      }

      // Create evolution request
      const evolution = await this.evolutionRepository.create({
        developmentCycleId,
        prompt,
        scope,
      });

      this.logger.info({ evolutionId: evolution.id }, 'Evolution request created');

      return { success: true, evolution };
    } catch (error: unknown) {
      const err = error as { message?: string };
      const errorMessage = err.message ?? 'Failed to create evolution request';
      this.logger.error({ error: errorMessage, developmentCycleId }, 'Evolution request failed');
      return { success: false, error: errorMessage };
    }
  }

  /**
   * Analyze an evolution request to determine impact
   */
  async analyzeEvolution(evolutionId: string): Promise<AnalyzeEvolutionResult> {
    this.logger.info({ evolutionId }, 'Analyzing evolution');

    try {
      const evolution = await this.evolutionRepository.findById(evolutionId);
      if (!evolution) {
        return { success: false, error: 'Evolution not found' };
      }

      // Update status to analyzing
      await this.evolutionRepository.update(evolutionId, { status: 'analyzing' });

      // Get all files for this cycle
      const files = await this.fileRepository.getByDevelopmentCycle(evolution.developmentCycleId);

      // Build context for Gemini
      const fileContext = files.map((f: { path: string; language: string; purpose: string; content: string }) => ({
        path: f.path,
        language: f.language,
        purpose: f.purpose,
        content: f.content,
      }));

      // Analyze with Gemini (with timeout to prevent infinite hangs)
      const ANALYSIS_TIMEOUT_MS = 120000; // 2 minute timeout
      const analysisPromise = this.geminiClient.analyzeEvolutionRequest({
        prompt: evolution.prompt,
        scope: evolution.scope ?? undefined,
        existingFiles: fileContext,
      });

      const analysisResponse = await Promise.race([
        analysisPromise,
        new Promise<{ success: false; error: string }>((resolve) =>
          setTimeout(() => {
            this.logger.error({ evolutionId }, 'Evolution analysis timed out after 2 minutes');
            resolve({ success: false, error: 'Evolution analysis timed out after 2 minutes' });
          }, ANALYSIS_TIMEOUT_MS)
        ),
      ]);

      if (!analysisResponse.success || !analysisResponse.data) {
        const failedEvolution = await this.evolutionRepository.markFailed(evolutionId, analysisResponse.error ?? 'Analysis failed');
        // Clear evolution cooldown since it failed
        if (failedEvolution) {
          await this.clearEvolutionCooldown(failedEvolution);
        }
        return { success: false, error: analysisResponse.error ?? 'Analysis failed' };
      }

      const analysis: EvolutionAnalysisResult = analysisResponse.data;
      const filesAffected = analysis.affectedFiles.length;

      // Check file limit
      const exceedsLimit = filesAffected > this.config.maxFilesPerEvolution;

      // Update evolution with analysis
      const updatedEvolution = await this.evolutionRepository.update(evolutionId, {
        status: exceedsLimit && this.config.requireConfirmationAboveLimit ? 'review' : 'generating',
        analysisResult: analysis,
        filesAffected,
      });

      this.logger.info(
        { evolutionId, filesAffected, exceedsLimit, impactLevel: analysis.impactLevel },
        'Evolution analysis complete'
      );

      return {
        success: true,
        evolution: updatedEvolution ?? evolution,
        analysis,
        exceedsLimit,
      };
    } catch (error: unknown) {
      const err = error as { message?: string };
      const errorMessage = err.message ?? 'Analysis failed';
      this.logger.error({ error: errorMessage, evolutionId }, 'Evolution analysis failed');
      const failedEvolution = await this.evolutionRepository.markFailed(evolutionId, errorMessage);
      // Clear evolution cooldown since it failed
      if (failedEvolution) {
        await this.clearEvolutionCooldown(failedEvolution);
      }
      return { success: false, error: errorMessage };
    }
  }

  /**
   * Generate proposed changes for an evolution
   */
  async generateChanges(evolutionId: string): Promise<GenerateEvolutionResult> {
    this.logger.info({ evolutionId }, 'Generating evolution changes');

    try {
      const evolution = await this.evolutionRepository.findById(evolutionId);
      if (!evolution) {
        return { success: false, error: 'Evolution not found' };
      }

      if (!evolution.analysisResult) {
        return { success: false, error: 'Evolution has not been analyzed yet' };
      }

      // Update status
      await this.evolutionRepository.update(evolutionId, { status: 'generating' });

      // Get files that will be affected
      const allFiles = await this.fileRepository.getByDevelopmentCycle(evolution.developmentCycleId);

      const affectedFilePaths = evolution.analysisResult.affectedFiles;
      const affectedFiles = allFiles.filter((f: { path: string }) =>
        affectedFilePaths.some((path: string) => f.path.includes(path) || path.includes(f.path))
      );

      // Build context
      const fileContext = affectedFiles.map((f: { path: string; language: string; purpose: string; content: string }) => ({
        path: f.path,
        language: f.language,
        purpose: f.purpose,
        content: f.content,
      }));

      // Generate changes with Gemini
      const generateResponse = await this.geminiClient.generateEvolutionChanges({
        prompt: evolution.prompt,
        analysis: evolution.analysisResult,
        filesToModify: fileContext,
      });

      if (!generateResponse.success || !generateResponse.data) {
        const failedEvolution = await this.evolutionRepository.markFailed(evolutionId, generateResponse.error ?? 'Generation failed');
        // Clear evolution cooldown since it failed
        if (failedEvolution) {
          await this.clearEvolutionCooldown(failedEvolution);
        }
        return { success: false, error: generateResponse.error ?? 'Generation failed' };
      }

      const proposedChanges: ProposedChange[] = generateResponse.data;

      // Update evolution with proposed changes
      const updatedEvolution = await this.evolutionRepository.update(evolutionId, {
        status: 'review',
        proposedChanges,
        filesAffected: proposedChanges.length,
      });

      this.logger.info(
        { evolutionId, changesCount: proposedChanges.length },
        'Evolution changes generated'
      );

      return {
        success: true,
        evolution: updatedEvolution ?? evolution,
        changes: proposedChanges,
      };
    } catch (error: unknown) {
      const err = error as { message?: string };
      const errorMessage = err.message ?? 'Generation failed';
      this.logger.error({ error: errorMessage, evolutionId }, 'Evolution generation failed');
      const failedEvolution = await this.evolutionRepository.markFailed(evolutionId, errorMessage);
      // Clear evolution cooldown since it failed
      if (failedEvolution) {
        await this.clearEvolutionCooldown(failedEvolution);
      }
      return { success: false, error: errorMessage };
    }
  }

  /**
   * Apply approved evolution changes
   *
   * Auto-approval behavior (controlled by CODE_EVOLUTION_AUTO_APPROVE env var):
   * - When autoApprove=true (default): Evolutions in 'review' status are automatically
   *   approved before applying. This enables dramatic self-healing demo.
   * - When autoApprove=false: Evolutions must be manually approved first.
   *   Returns success=false with awaitingApproval=true if not approved.
   */
  async applyEvolution(evolutionId: string, approvedBy: string): Promise<ApplyEvolutionResult> {
    this.logger.info({ evolutionId, approvedBy }, 'Applying evolution');

    try {
      const evolution = await this.evolutionRepository.findById(evolutionId);
      if (!evolution) {
        return { success: false, error: 'Evolution not found' };
      }

      if (!evolution.proposedChanges || evolution.proposedChanges.length === 0) {
        return { success: false, error: 'No proposed changes to apply' };
      }

      // Handle auto-approval for incident-triggered evolutions
      if (evolution.status === 'review') {
        if (this.config.autoApprove) {
          // Auto-approve mode: automatically approve before applying
          this.logger.info({
            evolutionId,
            triggeredByIncident: evolution.triggeredByIncidentId,
          }, 'Auto-approving evolution (autonomous mode)');

          await this.evolutionRepository.approve(
            evolutionId,
            'auto-approve-system',
            `Automatically approved for ${evolution.triggeredByIncidentId ? 'incident-triggered' : 'autonomous'} code fix`
          );
        } else {
          // Human approval required mode
          this.logger.info({
            evolutionId,
            triggeredByIncident: evolution.triggeredByIncidentId,
          }, 'Evolution requires human approval (CODE_EVOLUTION_AUTO_APPROVE=false)');

          return {
            success: false,
            error: 'Evolution requires human approval before applying',
            awaitingApproval: true,
          };
        }
      }

      if (evolution.status !== 'approved' && evolution.status !== 'review') {
        return { success: false, error: `Cannot apply evolution in ${evolution.status} status` };
      }

      // Get all files for the cycle
      const files = await this.fileRepository.getByDevelopmentCycle(evolution.developmentCycleId);

      const fileMap = new Map(files.map((f: { path: string; id: string }) => [f.path, f]));
      let filesUpdated = 0;

      // Log summary of all proposed changes for debugging
      this.logger.info({
        evolutionId,
        totalChanges: evolution.proposedChanges.length,
        changesSummary: evolution.proposedChanges.map(c => ({
          filePath: c.filePath,
          changeType: c.changeType,
          oldContentLength: c.oldContent?.length || 0,
          newContentLength: c.newContent?.length || 0,
          description: c.description?.substring(0, 100),
        })),
      }, 'Applying evolution changes');

      // Validate all create/modify changes have newContent before applying any
      for (const change of evolution.proposedChanges) {
        if ((change.changeType === 'create' || change.changeType === 'modify') &&
            (!change.newContent || change.newContent.length === 0)) {
          this.logger.error({
            evolutionId,
            filePath: change.filePath,
            changeType: change.changeType,
            description: change.description,
            hasNewContent: !!change.newContent,
            newContentLength: change.newContent?.length || 0,
          }, 'CRITICAL: Evolution change missing newContent - cannot apply');

          // Mark evolution as failed
          await this.evolutionRepository.markFailed(
            evolutionId,
            `Missing newContent for ${change.changeType} change on ${change.filePath}. AI response may have been truncated.`
          );

          // Clear evolution cooldown since it failed
          const failedEvolution = await this.evolutionRepository.findById(evolutionId);
          if (failedEvolution) {
            await this.clearEvolutionCooldown(failedEvolution);
          }

          return {
            success: false,
            error: `Missing newContent for ${change.changeType} change on ${change.filePath}. AI response may have been truncated.`,
          };
        }
      }

      // Apply each change
      for (const change of evolution.proposedChanges) {
        const existingFile = fileMap.get(change.filePath);

        // Log individual change details
        this.logger.info({
          evolutionId,
          filePath: change.filePath,
          changeType: change.changeType,
          oldContentLength: change.oldContent?.length || 0,
          newContentLength: change.newContent?.length || 0,
          description: change.description,
          hasExistingFile: !!existingFile,
        }, 'Applying evolution change');

        if (change.changeType === 'delete') {
          if (existingFile) {
            // Create version record before deletion
            const nextVersion = await this.versionRepository.getNextVersionNumber(existingFile.id);
            await this.versionRepository.create({
              generatedFileId: existingFile.id,
              developmentCycleId: evolution.developmentCycleId,
              version: nextVersion,
              content: '', // Empty for deletion
              changeType: 'evolution',
              changeDescription: `Deleted by evolution: ${evolution.prompt.substring(0, 50)}`,
              changedBy: 'ai',
              evolutionId,
            });

            // Mark file as deleted (or actually delete)
            await this.fileRepository.update(existingFile.id, {
              content: '// FILE DELETED BY EVOLUTION',
              validationStatus: 'valid',
            });
            filesUpdated++;
          }
        } else if (change.changeType === 'create' && change.newContent) {
          // Create new file
          const newFile = await this.fileRepository.create({
            developmentCycleId: evolution.developmentCycleId,
            path: change.filePath,
            language: this.detectLanguage(change.filePath),
            purpose: change.description,
            isNew: true,
            content: change.newContent,
          });

          // Create initial version
          await this.versionRepository.create({
            generatedFileId: newFile.id,
            developmentCycleId: evolution.developmentCycleId,
            version: 1,
            content: change.newContent,
            changeType: 'evolution',
            changeDescription: `Created by evolution: ${evolution.prompt.substring(0, 50)}`,
            changedBy: 'ai',
            evolutionId,
          });
          filesUpdated++;
        } else if (change.changeType === 'modify' && existingFile && change.newContent) {
          // Create version record before modification
          const nextVersion = await this.versionRepository.getNextVersionNumber(existingFile.id);
          await this.versionRepository.create({
            generatedFileId: existingFile.id,
            developmentCycleId: evolution.developmentCycleId,
            version: nextVersion,
            content: change.newContent,
            changeType: 'evolution',
            changeDescription: `Modified by evolution: ${evolution.prompt.substring(0, 50)}`,
            changedBy: 'ai',
            evolutionId,
          });

          // Update file content
          await this.fileRepository.update(existingFile.id, {
            content: change.newContent,
            validationStatus: 'pending',
          });
          filesUpdated++;
        } else if (change.changeType === 'modify' && !existingFile) {
          // LOG WARNING: File path from Gemini doesn't match any file in database
          this.logger.warn({
            evolutionId,
            filePath: change.filePath,
            changeType: change.changeType,
            availablePaths: files.map((f: { path: string }) => f.path),
          }, 'SKIPPED: Could not find file to modify - path mismatch between Gemini response and database');
        } else if (change.changeType === 'modify' && !change.newContent) {
          // LOG WARNING: Gemini returned modify without newContent
          this.logger.warn({
            evolutionId,
            filePath: change.filePath,
            changeType: change.changeType,
            hasNewContent: !!change.newContent,
          }, 'SKIPPED: Modify change has no newContent');
        }
      }

      // Mark evolution as applied
      const updatedEvolution = await this.evolutionRepository.markApplied(evolutionId);

      this.logger.info({ evolutionId, filesUpdated }, 'Evolution applied');

      // Clear evolution cooldown now that it's applied
      if (updatedEvolution) {
        await this.clearEvolutionCooldown(updatedEvolution);
      }

      return {
        success: true,
        evolution: updatedEvolution ?? evolution,
        filesUpdated,
      };
    } catch (error: unknown) {
      const err = error as { message?: string };
      const errorMessage = err.message ?? 'Failed to apply evolution';
      this.logger.error({ error: errorMessage, evolutionId }, 'Evolution application failed');
      return { success: false, error: errorMessage };
    }
  }

  /**
   * Run the complete evolution cycle automatically
   * Used when incident-triggered evolutions should run without human intervention.
   *
   * Flow: pending -> analyzing -> generating -> review -> approved -> applied
   *
   * This method orchestrates the entire evolution pipeline in one call:
   * 1. Analyze the evolution request to determine impact
   * 2. Generate the proposed code changes
   * 3. Apply the changes (auto-approval is handled by applyEvolution)
   *
   * @param evolutionId - The ID of the evolution to run
   * @returns Result indicating success/failure with updated evolution record
   */
  async runFullEvolutionCycle(evolutionId: string): Promise<ApplyEvolutionResult> {
    this.logger.info({ evolutionId }, 'Running full automatic evolution cycle');

    try {
      // Step 1: Analyze the evolution
      this.logger.info({ evolutionId, step: 1 }, 'Step 1/3: Analyzing evolution');
      const analyzeResult = await this.analyzeEvolution(evolutionId);
      if (!analyzeResult.success) {
        this.logger.error({
          evolutionId,
          step: 1,
          error: analyzeResult.error,
        }, 'Automatic evolution failed at analysis step');
        return {
          success: false,
          error: `Analysis failed: ${analyzeResult.error}`,
        };
      }

      this.logger.info({
        evolutionId,
        step: 1,
        filesAffected: analyzeResult.analysis?.affectedFiles.length,
        impactLevel: analyzeResult.analysis?.impactLevel,
      }, 'Analysis complete');

      // Step 2: Generate changes
      this.logger.info({ evolutionId, step: 2 }, 'Step 2/3: Generating code changes');
      const generateResult = await this.generateChanges(evolutionId);
      if (!generateResult.success) {
        this.logger.error({
          evolutionId,
          step: 2,
          error: generateResult.error,
        }, 'Automatic evolution failed at generation step');
        return {
          success: false,
          error: `Generation failed: ${generateResult.error}`,
        };
      }

      this.logger.info({
        evolutionId,
        step: 2,
        changesCount: generateResult.changes?.length,
      }, 'Changes generated');

      // Step 3: Apply the evolution (this handles auto-approval internally via config.autoApprove)
      this.logger.info({ evolutionId, step: 3 }, 'Step 3/3: Applying evolution');
      const applyResult = await this.applyEvolution(evolutionId, 'auto-incident-system');

      if (!applyResult.success) {
        this.logger.error({
          evolutionId,
          step: 3,
          error: applyResult.error,
          awaitingApproval: applyResult.awaitingApproval,
        }, 'Automatic evolution failed at apply step');
        return applyResult;
      }

      this.logger.info({
        evolutionId,
        filesUpdated: applyResult.filesUpdated,
      }, 'Full automatic evolution cycle completed successfully');

      return applyResult;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error({ error: errorMessage, evolutionId }, 'Automatic evolution cycle failed with exception');

      // Mark evolution as failed
      try {
        await this.evolutionRepository.markFailed(evolutionId, errorMessage);
      } catch {
        // Ignore failure to mark as failed
      }

      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Revert an applied evolution
   */
  async revertEvolution(evolutionId: string, reason: string): Promise<RevertEvolutionResult> {
    this.logger.info({ evolutionId, reason }, 'Reverting evolution');

    try {
      const evolution = await this.evolutionRepository.findById(evolutionId);
      if (!evolution) {
        return { success: false, error: 'Evolution not found' };
      }

      if (evolution.status !== 'applied') {
        return { success: false, error: `Cannot revert evolution in ${evolution.status} status` };
      }

      // Get versions created by this evolution
      const versions = await this.versionRepository.findByEvolutionId(evolutionId);

      // Group by file and get previous version for each
      const fileVersionsMap = new Map<string, { current: typeof versions[0]; previous?: typeof versions[0] }>();

      for (const version of versions) {
        if (!fileVersionsMap.has(version.generatedFileId)) {
          // Get the previous version
          const previousVersion = await this.versionRepository.findByFileIdAndVersion(
            version.generatedFileId,
            version.version - 1
          );
          fileVersionsMap.set(version.generatedFileId, { current: version, previous: previousVersion ?? undefined });
        }
      }

      let filesReverted = 0;

      // Revert each file
      for (const [fileId, { current, previous }] of fileVersionsMap) {
        if (previous) {
          // Revert to previous content
          await this.fileRepository.update(fileId, {
            content: previous.content,
            validationStatus: 'valid',
          });

          // Create revert version record
          const nextVersion = await this.versionRepository.getNextVersionNumber(fileId);
          await this.versionRepository.create({
            generatedFileId: fileId,
            developmentCycleId: evolution.developmentCycleId,
            version: nextVersion,
            content: previous.content,
            changeType: 'revert',
            changeDescription: `Reverted evolution: ${reason}`,
            changedBy: 'system',
            evolutionId,
          });
          filesReverted++;
        } else if (current.changeType === 'evolution') {
          // This was a new file - delete it (or mark as deleted)
          await this.fileRepository.update(fileId, {
            content: '// FILE REMOVED BY REVERT',
            validationStatus: 'valid',
          });
          filesReverted++;
        }
      }

      // Mark evolution as reverted
      const updatedEvolution = await this.evolutionRepository.markReverted(evolutionId, reason);

      this.logger.info({ evolutionId, filesReverted, reason }, 'Evolution reverted');

      // Clear evolution cooldown now that it's reverted
      if (updatedEvolution) {
        await this.clearEvolutionCooldown(updatedEvolution);
      }

      return {
        success: true,
        evolution: updatedEvolution ?? evolution,
        filesReverted,
      };
    } catch (error: unknown) {
      const err = error as { message?: string };
      const errorMessage = err.message ?? 'Failed to revert evolution';
      this.logger.error({ error: errorMessage, evolutionId }, 'Evolution revert failed');
      return { success: false, error: errorMessage };
    }
  }

  /**
   * Auto-revert evolution if deployment fails (called by build orchestrator)
   * Also reverts the associated git commit if available
   */
  async autoRevertOnFailure(evolutionId: string, deploymentError: string): Promise<RevertEvolutionResult> {
    if (!this.config.autoRevertOnFailure) {
      this.logger.info({ evolutionId }, 'Auto-revert disabled, skipping');
      return { success: true };
    }

    // First revert the evolution in the database
    const revertResult = await this.revertEvolution(evolutionId, `Deployment failed: ${deploymentError}`);
    
    if (!revertResult.success) {
      return revertResult;
    }

    // If git service is available, also commit the revert
    if (this.gitService?.isEnabled() && revertResult.evolution) {
      try {
        // Get files affected by this evolution
        const versions = await this.versionRepository.findByEvolutionId(evolutionId);
        const affectedFilePaths: string[] = [];
        
        for (const version of versions) {
          const file = await this.fileRepository.getById(version.generatedFileId);
          if (file) {
            affectedFilePaths.push(file.path);
          }
        }

        if (affectedFilePaths.length > 0) {
          // Get the repo path from the first file's directory
          const firstFile = affectedFilePaths[0];
          const repoPath = firstFile ? firstFile.split('/').slice(0, -1).join('/') || '.' : '.';

          // Commit the revert (commitChanges handles staging)
          const commitResult = await this.gitService.commitChanges(repoPath, {
            message: `revert: Auto-revert evolution ${evolutionId.slice(0, 8)}

Reason: Deployment failed - ${deploymentError}
Files reverted: ${revertResult.filesReverted ?? 0}`,
          });

          if (commitResult.success && commitResult.commit) {
            this.logger.info(
              { evolutionId, commitHash: commitResult.commit.shortHash },
              'Auto-reverted evolution in git'
            );
          } else if (!commitResult.commit) {
            this.logger.debug(
              { evolutionId },
              'No git changes to commit after revert'
            );
          } else {
            this.logger.warn(
              { evolutionId, error: commitResult.error },
              'Failed to commit git revert - database revert still applied'
            );
          }
        }
      } catch (error) {
        this.logger.warn(
          { evolutionId, error },
          'Exception during git revert - database revert still applied'
        );
      }
    }

    return revertResult;
  }

  /**
   * Approve an evolution for application
   */
  async approveEvolution(evolutionId: string, approvedBy: string, notes?: string): Promise<CodeEvolutionRecord | null> {
    this.logger.info({ evolutionId, approvedBy }, 'Approving evolution');
    return this.evolutionRepository.approve(evolutionId, approvedBy, notes);
  }

  /**
   * Reject an evolution
   */
  async rejectEvolution(evolutionId: string, rejectedBy: string, notes?: string): Promise<CodeEvolutionRecord | null> {
    this.logger.info({ evolutionId, rejectedBy }, 'Rejecting evolution');
    const rejectedEvolution = await this.evolutionRepository.reject(evolutionId, rejectedBy, notes);

    // Clear evolution cooldown since the evolution is rejected
    if (rejectedEvolution) {
      await this.clearEvolutionCooldown(rejectedEvolution);
    }

    return rejectedEvolution;
  }

  /**
   * Get all evolutions for a cycle
   */
  async getEvolutionsForCycle(developmentCycleId: string): Promise<CodeEvolutionRecord[]> {
    return this.evolutionRepository.findByCycleId(developmentCycleId);
  }

  /**
   * Get evolution by ID
   */
  async getEvolution(evolutionId: string): Promise<CodeEvolutionRecord | null> {
    return this.evolutionRepository.findById(evolutionId);
  }

  /**
   * Link an evolution to the incident that triggered it
   * Used when incidents trigger code fixes during investigation
   */
  async linkToIncident(evolutionId: string, incidentId: string): Promise<CodeEvolutionRecord | null> {
    this.logger.info({ evolutionId, incidentId }, 'Linking evolution to incident');
    return this.evolutionRepository.update(evolutionId, { triggeredByIncidentId: incidentId });
  }

  /**
   * Find evolutions triggered by a specific incident
   */
  async findByIncidentId(incidentId: string): Promise<CodeEvolutionRecord[]> {
    // Get all evolutions and filter by incident ID
    // Note: Could be optimized with a dedicated repository method if needed
    const allEvolutions = await this.evolutionRepository.findByStatus([
      'pending', 'analyzing', 'generating', 'review', 'approved', 'applied', 'failed'
    ]);
    return allEvolutions.filter(e => e.triggeredByIncidentId === incidentId);
  }

  /**
   * Trigger rebuild and redeploy after code evolution is applied
   * This completes the self-healing loop: Incident → Investigation → Code Fix → Rebuild → Redeploy
   */
  async triggerRebuildAndRedeploy(evolutionId: string): Promise<{
    success: boolean;
    message: string;
    buildResult?: { imageTag?: string };
    deployResult?: { serviceUrl?: string };
  }> {
    this.logger.info({ evolutionId }, 'Triggering rebuild and redeploy after evolution');

    try {
      const evolution = await this.evolutionRepository.findById(evolutionId);
      if (!evolution) {
        return { success: false, message: 'Evolution not found' };
      }

      if (evolution.status !== 'applied') {
        return { success: false, message: `Cannot rebuild: evolution status is ${evolution.status}, must be 'applied'` };
      }

      // Dynamically import to avoid circular dependencies
      const { DevelopmentOrchestrator } = await import('../orchestrator/development-orchestrator.js');
      const { developmentCycleRepository } = await import('@chronosops/database');

      // Get the development cycle
      const cycle = await developmentCycleRepository.getById(evolution.developmentCycleId);
      if (!cycle) {
        return { success: false, message: 'Development cycle not found' };
      }

      this.logger.info({
        evolutionId,
        cycleId: cycle.id,
        cyclePhase: cycle.phase,
      }, 'Initiating rebuild cycle after code evolution');

      // Initialize K8s client for deployment
      // Use environment-based config for in-cluster K8s, not database config
      const { K8sClient } = await import('@chronosops/kubernetes');

      // Check if running inside Kubernetes cluster
      const isInCluster = !!process.env.KUBERNETES_SERVICE_HOST;
      let k8sClient: InstanceType<typeof K8sClient> | undefined;

      if (isInCluster) {
        try {
          // In-cluster: K8sClient will auto-detect using service account
          k8sClient = new K8sClient({
            allowedNamespaces: ['development', 'default'],
            allowedActions: ['rollback', 'restart', 'scale', 'apply', 'create'],
            dryRun: false,
          });
          this.logger.info('K8s client initialized for in-cluster rebuild');
        } catch (error) {
          this.logger.warn({ error: (error as Error).message }, 'Could not initialize K8s client in-cluster, using simulated mode');
        }
      } else {
        // Local development: try to use local kubeconfig
        try {
          k8sClient = new K8sClient({
            allowedNamespaces: ['development', 'default'],
            allowedActions: ['rollback', 'restart', 'scale', 'apply', 'create'],
            dryRun: false,
          });
          this.logger.info('K8s client initialized for local rebuild');
        } catch (error) {
          this.logger.info({ error: (error as Error).message }, 'No K8s available locally, using simulated mode');
        }
      }

      // Get build config from environment (includes auto-detected buildMode)
      const appConfig = getConfig();
      const buildMode = appConfig.docker.buildMode;
      const kanikoConfig = buildMode === 'kaniko' ? {
        namespace: appConfig.docker.kanikoNamespace,
        serviceAccount: appConfig.docker.kanikoServiceAccount,
      } : undefined;

      // Validate registry is configured - fail fast instead of silently using localhost
      if (!appConfig.docker.registry) {
        const errorMsg = 'DOCKER_REGISTRY is not configured. Set DOCKER_REGISTRY env var (e.g., us-central1-docker.pkg.dev/PROJECT/REPO for GKE)';
        this.logger.error({ isInCluster, buildMode }, errorMsg);
        return { success: false, message: errorMsg };
      }

      this.logger.info({
        isInCluster,
        buildMode,
        kanikoConfig: kanikoConfig ? 'configured' : 'none',
        registry: appConfig.docker.registry,
      }, 'Build configuration for evolution rebuild');

      // Create DevelopmentOrchestrator with K8s client and build config
      const orchestrator = new DevelopmentOrchestrator(
        {
          geminiClient: this.geminiClient,
          k8sClient,
        },
        {
          build: {
            registry: appConfig.docker.registry,
            baseImage: appConfig.docker.baseImage,
            enableCache: true,
            buildMode,
            kaniko: kanikoConfig,
          },
        }
      );

      // Run rebuild and redeploy phases
      // Note: This is a simplified version - in production, we'd reuse the full orchestrator flow
      const result = await orchestrator.rebuildAndRedeployCycle(cycle.id);

      if (result.success) {
        this.logger.info({
          evolutionId,
          cycleId: cycle.id,
          serviceUrl: result.serviceUrl,
        }, 'Self-healing loop completed: code evolved, rebuilt, and redeployed');

        // Update evolution with deployment info (use appliedAt to track when it was deployed)
        await this.evolutionRepository.update(evolutionId, {
          appliedAt: new Date(),
          status: 'applied',
        });

        return {
          success: true,
          message: 'Code evolved, rebuilt, and redeployed successfully',
          buildResult: { imageTag: result.imageTag },
          deployResult: { serviceUrl: result.serviceUrl },
        };
      } else {
        this.logger.error({
          evolutionId,
          cycleId: cycle.id,
          error: result.error,
        }, 'Rebuild/redeploy failed after evolution');

        return {
          success: false,
          message: result.error ?? 'Rebuild/redeploy failed',
        };
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error({ error: errorMessage, evolutionId }, 'Failed to trigger rebuild/redeploy');
      return { success: false, message: errorMessage };
    }
  }

  /**
   * Detect language from file path
   */
  private detectLanguage(filePath: string): GeneratedFileRecord['language'] {
    const ext = filePath.split('.').pop()?.toLowerCase();
    const languageMap: Record<string, GeneratedFileRecord['language']> = {
      ts: 'typescript',
      tsx: 'typescript',
      js: 'javascript',
      jsx: 'javascript',
      json: 'json',
      yaml: 'yaml',
      yml: 'yaml',
      dockerfile: 'dockerfile',
      md: 'markdown',
      sh: 'shell',
      css: 'css',
      html: 'html',
    };
    return languageMap[ext ?? ''] ?? 'typescript';
  }

  /**
   * Clear the evolution cooldown for the app associated with this evolution
   * Called when evolution completes (applied, rejected, failed, or reverted)
   */
  private async clearEvolutionCooldown(evolution: CodeEvolutionRecord): Promise<void> {
    try {
      const { developmentCycleRepository } = await import('@chronosops/database');
      const cycle = await developmentCycleRepository.getById(evolution.developmentCycleId);

      if (cycle) {
        // Parse deployment JSON to get deployment name, or use requirementRaw as fallback
        let appName: string | undefined;

        if (cycle.deployment) {
          try {
            const deploymentInfo = JSON.parse(cycle.deployment) as { deploymentName?: string };
            appName = deploymentInfo.deploymentName;
          } catch {
            // Deployment field is not valid JSON
          }
        }

        // Fall back to requirement raw (first 50 chars, sanitized) if no deployment name
        if (!appName && cycle.requirementRaw) {
          appName = cycle.requirementRaw
            .slice(0, 50)
            .replace(/[^a-zA-Z0-9-]/g, '-')
            .toLowerCase();
        }

        if (appName) {
          const { DetectionStateManager } = await import('../detection/detection-state-manager.js');
          const stateManager = DetectionStateManager.getInstance();
          stateManager.clearPendingEvolution(appName);
          this.logger.info({
            appName,
            evolutionId: evolution.id,
            evolutionStatus: evolution.status,
          }, 'Cleared evolution cooldown');
        }
      }
    } catch (error) {
      // Non-critical - log but don't throw
      this.logger.warn({
        error: (error as Error).message,
        evolutionId: evolution.id,
      }, 'Failed to clear evolution cooldown (non-critical)');
    }
  }
}

// Singleton instance
let evolutionEngineInstance: CodeEvolutionEngine | null = null;

export function getCodeEvolutionEngine(): CodeEvolutionEngine {
  if (!evolutionEngineInstance) {
    evolutionEngineInstance = new CodeEvolutionEngine();
  }
  return evolutionEngineInstance;
}

export function resetCodeEvolutionEngine(): void {
  evolutionEngineInstance = null;
}
