/**
 * Code Fixer
 * Uses Gemini to fix validation errors in generated code
 */

import { createChildLogger } from '@chronosops/shared';
import type { GeneratedFile, CodeValidationResult, CodeValidationIssue } from '@chronosops/shared';
import type { GeminiClient } from '@chronosops/gemini';
import type { CodeFixResult, CodeGenerationConfig, TimeBudget } from './types.js';
import { DEFAULT_CODE_GENERATION_CONFIG, MIN_TIME_FOR_FIX_ITERATION_MS } from './types.js';
import { CodeValidator } from './code-validator.js';
import { fastValidator, autoFixer } from './fast-validator.js';

export class CodeFixer {
  private geminiClient: GeminiClient;
  private validator: CodeValidator;
  private config: CodeGenerationConfig;
  private logger = createChildLogger({ component: 'CodeFixer' });
  private currentThoughtSignature?: string;

  constructor(
    geminiClient: GeminiClient,
    config: Partial<CodeGenerationConfig> = {}
  ) {
    this.geminiClient = geminiClient;
    this.config = { ...DEFAULT_CODE_GENERATION_CONFIG, ...config };
    this.validator = new CodeValidator(config);
  }

  /**
   * Get all errors from validation result (deduplicated by file+line+message)
   */
  private getAllErrors(validationResult: CodeValidationResult): CodeValidationIssue[] {
    const allErrors = [
      ...validationResult.typeErrors,
      ...validationResult.lintErrors,
      ...validationResult.testErrors,
    ];
    
    // Deduplicate errors by file + line + core message (ignore prefix like [null])
    const seen = new Set<string>();
    const deduplicated: CodeValidationIssue[] = [];
    
    for (const error of allErrors) {
      // Normalize message by removing common prefixes
      const coreMessage = error.message.replace(/^\[\w+\]\s*/, '').replace(/^Parsing error:\s*/, '');
      const key = `${error.file}:${error.line}:${coreMessage}`;
      
      if (!seen.has(key)) {
        seen.add(key);
        deduplicated.push(error);
      }
    }
    
    return deduplicated;
  }

  /**
   * Attempt to fix validation errors in the code
   * @param files - Generated files to fix
   * @param validationResult - Validation result with errors
   * @param iteration - Current fix iteration (default 1)
   * @param thoughtSignature - Previous AI reasoning context for continuity
   * @param timeBudget - Optional time budget to prevent timeout exhaustion
   */
  async fix(
    files: GeneratedFile[],
    validationResult: CodeValidationResult,
    iteration: number = 1,
    thoughtSignature?: string,
    timeBudget?: TimeBudget
  ): Promise<CodeFixResult> {
    const startTime = Date.now();
    const allErrors = this.getAllErrors(validationResult);

    // Store thoughtSignature for recursive calls
    if (thoughtSignature) {
      this.currentThoughtSignature = thoughtSignature;
    }

    // TIME BUDGET CHECK: Early termination if insufficient time for another iteration
    // This prevents wasting time on iterations that will timeout anyway
    if (timeBudget) {
      const elapsed = Date.now() - timeBudget.startTime;
      const remaining = timeBudget.timeoutMs - elapsed;

      if (remaining < MIN_TIME_FOR_FIX_ITERATION_MS) {
        this.logger.warn({
          iteration,
          remainingMs: remaining,
          requiredMs: MIN_TIME_FOR_FIX_ITERATION_MS,
          elapsedMs: elapsed,
          timeoutMs: timeBudget.timeoutMs,
        }, 'Insufficient time for next fix iteration - returning best effort code');

        return {
          success: false,
          fixedFiles: files,
          error: `Time budget exhausted (${Math.round(remaining / 1000)}s remaining, need ${Math.round(MIN_TIME_FOR_FIX_ITERATION_MS / 1000)}s)`,
          iteration,
          processingTimeMs: Date.now() - startTime,
        };
      }
    }

    // Log actual errors for debugging
    this.logger.info({
      iteration,
      errorCount: allErrors.length,
      fileCount: files.length,
      hasThoughtSignature: !!this.currentThoughtSignature,
      hasTimeBudget: !!timeBudget,
      errors: allErrors.slice(0, 5).map(e => ({ file: e.file, line: e.line, message: e.message.substring(0, 100) })),
    }, 'Starting code fix attempt');

    if (iteration > this.config.maxFixRetries) {
      return {
        success: false,
        error: `Maximum fix retries (${this.config.maxFixRetries}) exceeded`,
        iteration,
        processingTimeMs: Date.now() - startTime,
      };
    }

    try {
      // STEP 1: Apply FastValidator auto-fixes first (handles pattern-based errors)
      // IMPORTANT: Validate and fix each file individually to avoid cross-file error contamination
      let autoFixedFiles = files.map(file => {
        if (file.language === 'typescript' || file.path.endsWith('.ts')) {
          const fileValidation = fastValidator.validate(file.content, this.config.storageMode);
          // Use hasFixableErrors instead of fixable - this applies fixes even if some errors are non-fixable
          if (!fileValidation.valid && fileValidation.hasFixableErrors) {
            const fixedContent = autoFixer.fix(file.content, fileValidation.errors);
            if (fixedContent !== file.content) {
              this.logger.debug({ file: file.path }, 'Auto-fix applied to file');
              return { ...file, content: fixedContent };
            }
          }
        }
        return file;
      });
      
      // Then run multi-file validation to check for cross-file issues
      const fastValidation = fastValidator.validateMultiple(
        autoFixedFiles.filter(f => f.language === 'typescript' || f.path.endsWith('.ts'))
          .map(f => ({ path: f.path, content: f.content })),
        this.config.storageMode
      );

      // Collect NON-FIXABLE FastValidator errors to pass to Gemini
      // These are pattern violations that require intelligent code restructuring
      const nonFixableFastValidatorErrors = fastValidation.errors.filter(
        e => !fastValidation.fixableErrorCodes.includes(e.code)
      );

      if (!fastValidation.valid && fastValidation.errors.length > 0) {
        this.logger.info({
          errorCount: fastValidation.errors.length,
          fixable: fastValidation.fixable,
          nonFixableCount: nonFixableFastValidatorErrors.length,
          nonFixableCodes: nonFixableFastValidatorErrors.map(e => e.code),
        }, 'FastValidator found errors in CodeFixer');
      }

      // Re-validate after auto-fixes
      let postAutoFixValidation = await this.validator.validate(autoFixedFiles);
      if (postAutoFixValidation.validationResult.valid && nonFixableFastValidatorErrors.length === 0) {
        this.logger.info({ iteration }, 'FastValidator auto-fix resolved all errors');
        return {
          success: true,
          fixedFiles: autoFixedFiles,
          iteration,
          processingTimeMs: Date.now() - startTime,
        };
      }

      // Circuit breaker: If auto-fix INCREASED errors, revert to pre-auto-fix files
      // This prevents FastValidator from injecting duplicate OpenAPI paths that cause
      // "An object literal cannot have multiple properties with the same name" errors
      const postAutoFixErrorCount = this.getAllErrors(postAutoFixValidation.validationResult).length;
      if (postAutoFixErrorCount > allErrors.length) {
        this.logger.warn({
          originalErrors: allErrors.length,
          postAutoFixErrors: postAutoFixErrorCount,
          delta: postAutoFixErrorCount - allErrors.length,
          iteration,
        }, 'FastValidator auto-fix INCREASED errors - reverting to pre-auto-fix code');
        // Revert to original files and re-validate without auto-fix
        autoFixedFiles = [...files];
        postAutoFixValidation = await this.validator.validate(autoFixedFiles);
      }

      // Continue with Gemini fixes for remaining errors
      // IMPORTANT: Include both TypeScript errors AND non-fixable FastValidator errors
      const remainingErrors = this.getAllErrors(postAutoFixValidation.validationResult);

      // Convert FastValidator errors to CodeValidationIssue format and add them
      // These pattern errors (MISSING_SCHEMA_PARSE, etc.) are CRITICAL for Gemini to understand
      for (const fvError of nonFixableFastValidatorErrors) {
        // Extract file path from error message (FastValidator prefixes with file path)
        const fileMatch = fvError.message.match(/^([^:]+\.ts):\s*/);
        const filePath = fileMatch?.[1] ?? 'unknown';
        const cleanMessage = fileMatch ? fvError.message.slice(fileMatch[0].length) : fvError.message;

        remainingErrors.push({
          file: filePath,
          line: fvError.line ?? 1,
          column: fvError.column ?? 1,
          message: `[FastValidator] ${cleanMessage} - FIX: ${fvError.fix}`,
          severity: 'error',
        });
      }
      const tsErrorCount = this.getAllErrors(postAutoFixValidation.validationResult).length;
      this.logger.info({
        originalTsErrors: allErrors.length,
        remainingTsErrors: tsErrorCount,
        fastValidatorErrors: nonFixableFastValidatorErrors.length,
        totalErrorsForGemini: remainingErrors.length,
        autoFixedCount: allErrors.length - tsErrorCount,
      }, 'After FastValidator auto-fix - including pattern errors for Gemini context');

      // STEP 2: Group remaining errors by file for Gemini fixes
      const errorsByFile = this.groupErrorsByFile(remainingErrors);

      // Sort files by priority: schema/types first, then by error count
      // This ensures critical files (that others depend on) are fixed first
      const prioritizedFiles = this.sortFilesByPriority(autoFixedFiles, errorsByFile);

      // Log files with errors and their priorities
      this.logger.info({
        filesWithErrors: Array.from(errorsByFile.keys()),
        errorCounts: Object.fromEntries(
          Array.from(errorsByFile.entries()).map(([k, v]) => [k, v.length])
        ),
        processingOrder: prioritizedFiles.slice(0, 5).map(f => f.path),
      }, 'Errors grouped by file - processing in priority order');

      // Fix each file with errors
      const fixedFiles: GeneratedFile[] = [];

      for (const file of prioritizedFiles) {
        // Normalize file path for matching
        const normalizedPath = file.path.replace(/^\.\//, '').replace(/\\/g, '/');

        // Use helper method for consistent error finding
        const fileErrors = this.findErrorsForFile(normalizedPath, errorsByFile);

        if (fileErrors.length === 0) {
          // No errors in this file, keep as-is
          fixedFiles.push(file);
          continue;
        }

        // Fix this file using Gemini, with cross-file context
        const otherFiles = autoFixedFiles.filter(f => f.path !== file.path);
        const fixedFile = await this.fixFile(file, fileErrors, iteration - 1, otherFiles, this.currentThoughtSignature);
        fixedFiles.push(fixedFile);
      }

      // Validate the fixed code
      const newValidation = await this.validator.validate(fixedFiles);

      if (newValidation.validationResult.valid) {
        this.logger.info({
          iteration,
          filesFixed: errorsByFile.size,
        }, 'Code fix successful');

        return {
          success: true,
          fixedFiles,
          iteration,
          processingTimeMs: Date.now() - startTime,
        };
      }

      // Still has errors - check if we made progress
      const previousErrors = allErrors.length;
      const newErrors = newValidation.validationResult.errorCount;

      if (newErrors >= previousErrors) {
        this.logger.warn({
          previousErrors,
          newErrors,
          iteration,
        }, 'Fix attempt did not reduce errors');

        // STOP if we've exhausted retries - don't keep making it worse
        if (iteration >= this.config.maxFixRetries) {
          this.logger.error({
            iteration,
            maxRetries: this.config.maxFixRetries,
            errorCount: newErrors,
          }, 'Max fix retries reached without reducing errors - returning best effort code');
          return {
            success: false,
            fixedFiles,
            iteration,
            error: `Fix attempts not reducing errors (stuck at ${newErrors} errors after ${iteration} attempts)`,
            processingTimeMs: Date.now() - startTime,
          };
        }
        // Try again with a fresh approach
        return this.fix(fixedFiles, newValidation.validationResult, iteration + 1, this.currentThoughtSignature, timeBudget);
      }

      // We made progress (errors reduced), continue fixing remaining errors
      return this.fix(fixedFiles, newValidation.validationResult, iteration + 1, this.currentThoughtSignature, timeBudget);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error({ error: errorMessage, iteration }, 'Code fix failed');

      return {
        success: false,
        error: errorMessage,
        iteration,
        processingTimeMs: Date.now() - startTime,
      };
    }
  }

  /**
   * Calculate priority score for a file based on its path and errors
   * Higher score = higher priority (should be fixed first)
   *
   * Priority order:
   * 1. Schema/types files (highest - others depend on them)
   * 2. Files with critical errors (Cannot find module, etc.)
   * 3. Files with more errors
   * 4. Other files
   */
  private calculateFilePriority(filePath: string, errors: CodeValidationIssue[]): number {
    let score = 0;
    const normalizedPath = filePath.toLowerCase();

    // Schema/types files get highest priority (300 points)
    // These define types that other files import
    if (normalizedPath.includes('schema') ||
        normalizedPath.includes('types') ||
        normalizedPath.includes('interface') ||
        normalizedPath.includes('model')) {
      score += 300;
    }

    // Files with critical errors get high priority (200 points)
    // These often block other files from compiling
    const hasCriticalError = errors.some(e =>
      e.message.includes('Cannot find module') ||
      e.message.includes('Cannot find name') ||
      e.message.includes('Module not found') ||
      e.message.includes('is not exported') ||
      e.message.includes('has no exported member')
    );
    if (hasCriticalError) {
      score += 200;
    }

    // More errors = higher priority (1-100 points based on error count)
    // Cap at 100 to not overwhelm other priorities
    score += Math.min(errors.length * 10, 100);

    // Index/entry files get slight boost (50 points)
    // They are often the main application entry points
    if (normalizedPath.includes('index') || normalizedPath.includes('main') || normalizedPath.includes('app')) {
      score += 50;
    }

    return score;
  }

  /**
   * Sort files by priority for optimal fix ordering
   */
  private sortFilesByPriority(
    files: GeneratedFile[],
    errorsByFile: Map<string, CodeValidationIssue[]>
  ): GeneratedFile[] {
    return [...files].sort((a, b) => {
      const normalizedPathA = a.path.replace(/^\.\//, '').replace(/\\/g, '/');
      const normalizedPathB = b.path.replace(/^\.\//, '').replace(/\\/g, '/');

      const errorsA = this.findErrorsForFile(normalizedPathA, errorsByFile);
      const errorsB = this.findErrorsForFile(normalizedPathB, errorsByFile);

      const priorityA = this.calculateFilePriority(a.path, errorsA);
      const priorityB = this.calculateFilePriority(b.path, errorsB);

      return priorityB - priorityA; // Higher priority first
    });
  }

  /**
   * Find errors for a file with flexible path matching
   */
  private findErrorsForFile(
    normalizedPath: string,
    errorsByFile: Map<string, CodeValidationIssue[]>
  ): CodeValidationIssue[] {
    // Try exact match first
    let fileErrors = errorsByFile.get(normalizedPath);
    if (fileErrors && fileErrors.length > 0) {
      return fileErrors;
    }

    // Try suffix match (handles temp dir prefixes)
    for (const [errorPath, errors] of errorsByFile.entries()) {
      if (errorPath.endsWith(normalizedPath) || normalizedPath.endsWith(errorPath)) {
        return errors;
      }
    }

    return [];
  }

  /**
   * Group errors by file path (with flexible matching)
   */
  private groupErrorsByFile(errors: CodeValidationIssue[]): Map<string, CodeValidationIssue[]> {
    const grouped = new Map<string, CodeValidationIssue[]>();

    for (const error of errors) {
      // Normalize the path - remove leading ./ and normalize slashes
      const normalizedPath = error.file.replace(/^\.\//, '').replace(/\\/g, '/');
      const existing = grouped.get(normalizedPath) ?? [];
      existing.push(error);
      grouped.set(normalizedPath, existing);
    }

    return grouped;
  }

  /**
   * Fix a single file using Gemini
   */
  private async fixFile(
    file: GeneratedFile,
    errors: CodeValidationIssue[],
    previousAttempts: number = 0,
    otherFiles: GeneratedFile[] = [],
    thoughtSignature?: string
  ): Promise<GeneratedFile> {
    this.logger.debug({
      file: file.path,
      errorCount: errors.length,
      previousAttempts,
    }, 'Fixing file');

    // Build error description with code context for better Gemini understanding
    const lines = file.content.split('\n');
    const errorDescription = errors
      .map((e) => {
        const lineNum = e.line;
        const context: string[] = [];
        // Show 2 lines before and after the error line
        for (let i = Math.max(0, lineNum - 3); i <= Math.min(lines.length - 1, lineNum + 1); i++) {
          const prefix = i + 1 === lineNum ? '>>> ' : '    ';
          context.push(`${prefix}${i + 1}: ${lines[i]}`);
        }
        return `Line ${lineNum}: ${e.message}\n${context.join('\n')}`;
      })
      .join('\n\n');

    // Build cross-file context - include related files that might export functions/types used in this file
    // This is critical for fixing cross-file import/reference errors
    const relatedContext = otherFiles
      .filter(f => {
        // Include types, schemas, interfaces
        if (f.path.includes('types') || f.path.includes('schema') || f.path.includes('interface')) {
          return true;
        }
        // Include service files (common source of function imports)
        if (f.path.includes('service') || f.path.includes('repository')) {
          return true;
        }
        // Include files that might be imported by checking error messages for hints
        const errorMentionsFile = errors.some(e => 
          e.message.includes(f.path) || 
          f.path.includes(e.message.match(/import.*from ['"]\.\/([^'"]+)/)?.[1] ?? '') ||
          f.path.includes(e.message.match(/Cannot find name '(\w+)'/)?.[1]?.toLowerCase() ?? '')
        );
        return errorMentionsFile;
      })
      .map(f => `=== ${f.path} (EXPORTS AVAILABLE) ===\n${f.content}`)
      .join('\n\n');

    // Map language to typescript/javascript (code fixer only supports these)
    const fixLanguage: 'typescript' | 'javascript' =
      file.language === 'javascript' ? 'javascript' : 'typescript';

    const response = await this.geminiClient.fixCode({
      code: file.content,
      errors: errorDescription,
      language: fixLanguage,
      context: `File: ${file.path}\nPurpose: ${file.purpose}${relatedContext ? `\n\n=== RELATED FILES (types/schemas) ===\n${relatedContext}` : ''}`,
      previousAttempts,
      thoughtSignature,
    });

    if (!response.success || !response.data) {
      this.logger.warn({
        file: file.path,
        error: response.error,
      }, 'Gemini fix failed, attempting manual fix');

      // Attempt basic manual fixes
      return {
        ...file,
        content: this.applyManualFixes(file.content, errors),
      };
    }

    // Extract fixed code from response, with truncation detection
    const { fixedContent, wasTruncated } = this.extractFixedCodeWithTruncationCheck(response.data, file.content);
    
    // If truncated, apply targeted manual fixes for common errors
    if (wasTruncated) {
      this.logger.info({
        file: file.path,
      }, 'Gemini response was truncated, applying targeted manual fixes instead');
      
      // Apply targeted fixes for the specific errors
      const manuallyFixed = this.applyTargetedFixes(file.content, errors);
      return {
        ...file,
        content: manuallyFixed,
      };
    }
    
    // Log if the fix actually changed the code
    const codeChanged = fixedContent !== file.content;
    this.logger.info({
      file: file.path,
      codeChanged,
      originalLength: file.content.length,
      fixedLength: fixedContent.length,
    }, 'Gemini fix applied');

    return {
      ...file,
      content: fixedContent,
    };
  }

  /**
   * Apply targeted fixes for specific error patterns that are commonly truncated
   */
  private applyTargetedFixes(content: string, errors: CodeValidationIssue[]): string {
    let fixed = content;
    
    for (const error of errors) {
      const message = error.message.toLowerCase();
      
      // Fix: 'NextFunction' is defined but never used
      if (message.includes('nextfunction') && message.includes('never used')) {
        // Remove NextFunction from import
        fixed = fixed.replace(
          /(import\s*\{[^}]*),\s*NextFunction(\s*\})/g,
          '$1$2'
        );
        fixed = fixed.replace(
          /(import\s*\{\s*)NextFunction\s*,([^}]*\})/g,
          '$1$2'
        );
        this.logger.info('Applied targeted fix: removed unused NextFunction import');
      }
      
      // Fix: Unused schema import (e.g., 'UserSchema' is defined but never used)
      if (message.includes('defined but never used') && message.includes('schema')) {
        // Extract the schema name from the error
        const schemaMatch = error.message.match(/'(\w+Schema)'/);
        if (schemaMatch) {
          const schemaName = schemaMatch[1];
          // Check if schema is actually used elsewhere (not just declared)
          const usageCount = (fixed.match(new RegExp(`\\b${schemaName}\\b`, 'g')) || []).length;
          if (usageCount === 1) {
            // Only declared, not used - remove the declaration
            // This is risky, so we'll just add a comment instead
            this.logger.info({ schemaName }, 'Found unused schema - will be handled by next Gemini iteration');
          }
        }
      }
      
      // Fix: string | string[] not assignable to string (req.params.id)
      if (message.includes('string | string[]') || message.includes('is not assignable to parameter of type \'string\'')) {
        // Add type assertion to req.params usage
        fixed = fixed.replace(
          /\(\s*(req\.params\.\w+)\s*\)(?!\s*as\s+string)/g,
          '($1 as string)'
        );
        fixed = fixed.replace(
          /const\s+(\w+)\s*=\s*(req\.params\.\w+)(?!\s*as\s+string)/g,
          'const $1 = $2 as string'
        );
        this.logger.info('Applied targeted fix: added type assertion to req.params');
      }
    }
    
    return fixed;
  }

  /**
   * Extract fixed code from Gemini response with truncation detection
   */
  private extractFixedCodeWithTruncationCheck(data: unknown, originalContent: string): { fixedContent: string; wasTruncated: boolean } {
    const result = this.extractFixedCode(data, originalContent);
    const wasTruncated = result === originalContent && 
      // Check if we actually tried to parse something (data exists)
      data !== null && data !== undefined;
    return { fixedContent: result, wasTruncated };
  }

  /**
   * Extract fixed code from Gemini response
   */
  private extractFixedCode(data: unknown, originalContent: string): string {
    const response = data as {
      fixedCode?: string;
      code?: string;
      content?: string;
      explanation?: string;
      allErrorsFixed?: boolean;
    };

    // Log response structure for debugging
    this.logger.debug({
      hasFixedCode: !!response.fixedCode,
      hasCode: !!response.code,
      hasContent: !!response.content,
      fixedCodeLength: response.fixedCode?.length ?? 0,
      allErrorsFixed: response.allErrorsFixed,
      explanation: response.explanation?.substring(0, 100),
    }, 'Extracting fixed code from Gemini response');

    // Try different response formats
    const fixedCode = response.fixedCode ?? response.code ?? response.content;

    if (typeof fixedCode === 'string' && fixedCode.length > 0) {
      // Clean up code blocks if present
      let cleaned = fixedCode
        .replace(/^```\w*\n?/, '')
        .replace(/\n?```$/, '')
        .trim();
      
      // Validate that we got actual code back (should have at least some TypeScript keywords)
      if (cleaned.includes('import') || cleaned.includes('export') || cleaned.includes('const') || cleaned.includes('function')) {
        // CRITICAL: Validate syntax integrity before accepting
        // Check 1: Balanced braces/brackets/parentheses
        const openBraces = (cleaned.match(/\{/g) || []).length;
        const closeBraces = (cleaned.match(/\}/g) || []).length;
        const openBrackets = (cleaned.match(/\[/g) || []).length;
        const closeBrackets = (cleaned.match(/\]/g) || []).length;
        const openParens = (cleaned.match(/\(/g) || []).length;
        const closeParens = (cleaned.match(/\)/g) || []).length;

        if (openBraces !== closeBraces || openBrackets !== closeBrackets || openParens !== closeParens) {
          this.logger.warn({
            openBraces,
            closeBraces,
            openBrackets,
            closeBrackets,
            openParens,
            closeParens,
          }, 'Gemini returned unbalanced code - rejecting fix to prevent syntax corruption');
          return originalContent;
        }

        // Check 2: Code shouldn't be significantly shorter (likely truncated)
        const lengthRatio = cleaned.length / originalContent.length;
        if (lengthRatio < 0.5) {
          this.logger.warn({
            originalLength: originalContent.length,
            fixedLength: cleaned.length,
            ratio: lengthRatio,
          }, 'Gemini returned significantly shorter code - likely truncated, rejecting fix');
          return originalContent;
        }

        // Check 3: Should not have obvious syntax corruption
        // NOTE: We only check ,, and ;; (genuine syntax errors), NOT {{ or }} because:
        // - {{ is valid in JSX: style={{ width: '100%' }}
        // - }} is valid in JSX and nested objects: { outer: { inner: true } }
        // - }} appears in template literals: `${expression}}`
        if (cleaned.includes(',,') || cleaned.includes(';;')) {
          this.logger.warn('Gemini returned code with doubled punctuation - rejecting fix');
          return originalContent;
        }

        return cleaned;
      }
      
      this.logger.warn({
        responseLength: cleaned.length,
        preview: cleaned.substring(0, 200),
      }, 'Gemini response does not appear to be valid code');
    }

    this.logger.warn('No valid fixed code in Gemini response, returning original');
    return originalContent;
  }

  /**
   * Apply basic manual fixes for common errors
   * 
   * NOTE: We deliberately avoid aggressive comma/semicolon injection here.
   * Experience shows that blindly adding punctuation causes more harm than good
   * because "',' expected" errors are usually symptoms of deeper issues like:
   * - Unclosed template literals
   * - Missing closing braces/brackets
   * - Invalid arrow function syntax
   * 
   * Let Gemini handle these complex structural fixes instead.
   */
  private applyManualFixes(content: string, errors: CodeValidationIssue[]): string {
    let fixedContent = content;

    for (const error of errors) {
      // Check for common error patterns in the message
      const message = error.message;

      // REMOVED: Aggressive comma/semicolon injection
      // These heuristics were causing more errors than they fixed:
      // - Adding commas to arrow function parameters: (req: Request, res: Response) =>,
      // - Adding commas to type annotations: const x: string,
      // - Adding semicolons mid-expression
      //
      // For syntax errors like "',' expected", we now let Gemini handle the fix
      // since it has context to understand the actual code structure.
      if (message.includes("',' expected") || message.includes("expected.")) {
        // Log but don't attempt blind fixes - Gemini will handle these
        this.logger.debug({ 
          line: error.line, 
          message: message.substring(0, 80),
        }, 'Syntax error detected - deferring to Gemini for structural fix');
        continue;
      }

      // REMOVED: Aggressive semicolon injection for parsing errors
      // Same reasoning - these require understanding code structure
      if (message.includes("Unknown keyword or identifier") || message.includes("Parsing error")) {
        this.logger.debug({ 
          line: error.line, 
          message: message.substring(0, 80),
        }, 'Parsing error detected - deferring to Gemini for fix');
        continue;
      }

      // Cannot find name - log for Gemini to handle
      // REMOVED: Adding TODO comments at top of file - this doesn't actually fix anything
      // and can interfere with import organization
      if (message.includes("Cannot find name")) {
        const match = message.match(/Cannot find name '(\w+)'/);
        if (match) {
          const name = match[1];
          this.logger.debug({ 
            missingName: name,
            line: error.line,
          }, 'Missing name detected - Gemini will add proper import');
        }
        continue;
      }

      // Parameter implicitly has 'any' type - add type annotation
      // This is a safe fix that doesn't risk breaking syntax
      if (message.includes("implicitly has an 'any' type")) {
        const match = message.match(/Parameter '(\w+)' implicitly has an 'any' type/);
        if (match) {
          const paramName = match[1];
          // Add unknown type to parameter - safe regex replacement
          fixedContent = fixedContent.replace(
            new RegExp(`\\b${paramName}\\s*(?=[,)])`),
            `${paramName}: unknown`
          );
        }
      }

      // Type assignment errors - let Gemini handle these
      // REMOVED: Adding @ts-expect-error comments - this hides bugs instead of fixing them
      // Gemini should fix the actual type mismatch
      if (message.includes("is not assignable to type")) {
        this.logger.debug({ 
          line: error.line,
          message: message.substring(0, 80),
        }, 'Type assignment error - Gemini will fix the type mismatch');
        continue;
      }

      // Expected X arguments but got Y - let Gemini handle
      // REMOVED: Adding TODO comments doesn't fix the actual issue
      if (message.includes("arguments") && message.includes("Expected")) {
        this.logger.debug({ 
          line: error.line,
          message: message.substring(0, 80),
        }, 'Argument count error - Gemini will fix function call');
        continue;
      }
    }

    return fixedContent;
  }

  /**
   * Validate and fix code in one operation
   */
  async validateAndFix(files: GeneratedFile[]): Promise<{
    success: boolean;
    files: GeneratedFile[];
    isValid: boolean;
    iterations: number;
    errors: CodeValidationIssue[];
  }> {
    // Initial validation
    const initialValidation = await this.validator.validate(files);

    if (initialValidation.validationResult.valid) {
      return {
        success: true,
        files,
        isValid: true,
        iterations: 0,
        errors: [],
      };
    }

    // Attempt to fix
    const fixResult = await this.fix(files, initialValidation.validationResult);

    if (fixResult.success && fixResult.fixedFiles) {
      // Final validation
      const finalValidation = await this.validator.validate(fixResult.fixedFiles);

      return {
        success: finalValidation.validationResult.valid,
        files: fixResult.fixedFiles,
        isValid: finalValidation.validationResult.valid,
        iterations: fixResult.iteration,
        errors: this.getAllErrors(finalValidation.validationResult),
      };
    }

    return {
      success: false,
      files,
      isValid: false,
      iterations: fixResult.iteration,
      errors: this.getAllErrors(initialValidation.validationResult),
    };
  }

  /**
   * Enhance OpenAPI specs in generated files using AI analysis
   * 
   * This method analyzes the source code and uses Gemini to generate
   * complete, accurate OpenAPI 3.0 specs with proper security schemes,
   * parameters, request bodies, and response schemas.
   * 
   * @param files - Generated files to enhance
   * @returns Files with AI-enhanced OpenAPI specs
   */
  async enhanceOpenApiSpecs(files: GeneratedFile[]): Promise<GeneratedFile[]> {
    const enhancedFiles: GeneratedFile[] = [];

    for (const file of files) {
      // Only process TypeScript files that might contain OpenAPI specs
      if (!file.path.endsWith('.ts') && !file.path.endsWith('.tsx')) {
        enhancedFiles.push(file);
        continue;
      }

      // Check if this file has an openApiSpec that needs enhancement
      const hasOpenApiSpec = /const\s+openApiSpec\s*=\s*\{/.test(file.content);
      if (!hasOpenApiSpec) {
        enhancedFiles.push(file);
        continue;
      }

      // Extract routes from the source code
      const routes = this.extractRoutes(file.content);
      if (routes.length === 0) {
        enhancedFiles.push(file);
        continue;
      }

      // Extract existing openApiSpec
      const existingSpec = this.extractOpenApiSpec(file.content);
      
      // Extract API name
      const apiNameMatch = file.content.match(/API_INFO\s*=\s*\{[^}]*name:\s*['"]([^'"]+)['"]/);
      const apiName = apiNameMatch?.[1] ?? 'API';

      this.logger.info({
        file: file.path,
        routeCount: routes.length,
        existingPathCount: Object.keys(existingSpec?.paths ?? {}).length,
        apiName,
      }, 'Enhancing OpenAPI spec with AI');

      try {
        // Call Gemini to enhance the OpenAPI spec
        const result = await this.geminiClient.enhanceOpenApiSpec({
          sourceCode: file.content,
          existingSpec: existingSpec ?? {},
          routes,
          apiName,
        });

        if (result.success && result.data) {
          // Validate the response is a valid OpenAPI spec structure
          const specData = result.data as Record<string, unknown>;
          
          // Check for required OpenAPI properties
          if (!specData.openapi || !specData.info || !specData.paths) {
            this.logger.warn({
              file: file.path,
              hasOpenapi: !!specData.openapi,
              hasInfo: !!specData.info,
              hasPaths: !!specData.paths,
              keys: Object.keys(specData).slice(0, 10),
            }, 'Invalid OpenAPI spec structure - missing required fields, keeping original');
            enhancedFiles.push(file);
            continue;
          }
          
          // Check for contamination - if the response contains code-like content
          const specJson = JSON.stringify(specData);
          const hasCodeContamination = 
            specJson.includes('function ') ||
            specJson.includes('export ') ||
            specJson.includes('import ') ||
            specJson.includes('const app =') ||
            specJson.includes('app.listen');
            
          if (hasCodeContamination) {
            this.logger.warn({
              file: file.path,
              specLength: specJson.length,
            }, 'OpenAPI spec appears to contain code - rejecting to prevent corruption');
            enhancedFiles.push(file);
            continue;
          }
          
          // Replace the openApiSpec in the file content
          const enhancedContent = this.replaceOpenApiSpec(file.content, result.data);
          
          // Verify the replacement didn't corrupt the file
          // NOTE: Allow up to 3x growth since proper OpenAPI specs are verbose
          // A detailed spec with security schemes, request bodies, response schemas,
          // and examples legitimately increases file size significantly
          if (enhancedContent.length > file.content.length * 3) {
            this.logger.warn({
              file: file.path,
              originalLength: file.content.length,
              enhancedLength: enhancedContent.length,
            }, 'OpenAPI enhancement tripled file size - likely corruption, keeping original');
            enhancedFiles.push(file);
            continue;
          }
          
          this.logger.info({
            file: file.path,
            enhancedPathCount: Object.keys((result.data as { paths?: Record<string, unknown> })?.paths ?? {}).length,
            hasSecuritySchemes: !!(result.data as { components?: { securitySchemes?: unknown } })?.components?.securitySchemes,
          }, 'OpenAPI spec enhanced successfully');

          enhancedFiles.push({
            ...file,
            content: enhancedContent,
          });
        } else {
          this.logger.warn({
            file: file.path,
            error: result.error,
          }, 'Failed to enhance OpenAPI spec, keeping original');
          enhancedFiles.push(file);
        }
      } catch (error) {
        this.logger.error({
          file: file.path,
          error: error instanceof Error ? error.message : 'Unknown error',
        }, 'Error enhancing OpenAPI spec');
        enhancedFiles.push(file);
      }
    }

    return enhancedFiles;
  }

  /**
   * Extract route handlers from source code
   */
  private extractRoutes(content: string): string[] {
    const routes: string[] = [];
    const routePattern = /app\.(get|post|put|patch|delete)\s*\(\s*['"`]([^'"`]+)['"`]/gi;
    let match;

    while ((match = routePattern.exec(content)) !== null) {
      const method = match[1]?.toLowerCase() ?? 'get';
      const path = match[2] ?? '/';
      // Skip documentation endpoints
      if (path === '/' || path === '/health' || path === '/openapi.json' || path === '/docs' || path === '/readyz') {
        continue;
      }
      routes.push(`${method}:${path}`);
    }

    return routes;
  }

  /**
   * Extract existing openApiSpec from source code
   */
  private extractOpenApiSpec(content: string): Record<string, unknown> | null {
    // Try to find and parse the openApiSpec object
    const specMatch = content.match(/const\s+openApiSpec\s*=\s*(\{[\s\S]*?\n\s*\};)/);
    if (!specMatch) {
      return null;
    }

    try {
      // This is a crude extraction - in production we'd use a proper parser
      // For now, we'll pass the raw content to the AI which can parse it better
      return { _rawSpec: specMatch[1] };
    } catch {
      return null;
    }
  }

  /**
   * Find matching closing brace with string-aware parsing
   * Properly handles braces inside strings, template literals, and comments
   */
  private findMatchingBrace(content: string, startIndex: number): number {
    let braceCount = 1;
    let i = startIndex;
    let inString = false;
    let stringChar = '';
    let inLineComment = false;
    let inBlockComment = false;

    while (i < content.length && braceCount > 0) {
      const char = content[i];
      const nextChar = content[i + 1] || '';
      const prevChar = i > 0 ? content[i - 1] : '';

      // Handle escape sequences in strings
      if (inString && prevChar === '\\') {
        i++;
        continue;
      }

      // Handle line comments
      if (!inString && !inBlockComment && char === '/' && nextChar === '/') {
        inLineComment = true;
        i++;
        continue;
      }
      if (inLineComment && char === '\n') {
        inLineComment = false;
        i++;
        continue;
      }

      // Handle block comments
      if (!inString && !inLineComment && char === '/' && nextChar === '*') {
        inBlockComment = true;
        i += 2;
        continue;
      }
      if (inBlockComment && char === '*' && nextChar === '/') {
        inBlockComment = false;
        i += 2;
        continue;
      }

      // Skip if in comment
      if (inLineComment || inBlockComment) {
        i++;
        continue;
      }

      // Handle string boundaries
      if (!inString && (char === '"' || char === "'" || char === '`')) {
        inString = true;
        stringChar = char;
        i++;
        continue;
      }
      if (inString && char === stringChar) {
        inString = false;
        stringChar = '';
        i++;
        continue;
      }

      // Skip if in string
      if (inString) {
        i++;
        continue;
      }

      // Count braces (only outside strings/comments)
      if (char === '{') braceCount++;
      else if (char === '}') braceCount--;

      i++;
    }

    return braceCount === 0 ? i : -1;
  }

  /**
   * Replace openApiSpec in source code with enhanced version
   */
  private replaceOpenApiSpec(content: string, enhancedSpec: Record<string, unknown>): string {
    // Find the openApiSpec declaration start position
    const specStartMatch = content.match(/const\s+openApiSpec\s*=\s*\{/);
    if (!specStartMatch || specStartMatch.index === undefined) {
      this.logger.warn('Could not find openApiSpec in content to replace');
      return content;
    }

    const startIndex = specStartMatch.index;
    const openBraceIndex = startIndex + specStartMatch[0].length - 1;

    // Find the matching closing brace using string-aware parsing
    const endIndex = this.findMatchingBrace(content, openBraceIndex + 1);

    if (endIndex === -1) {
      this.logger.warn('Unbalanced braces in openApiSpec - cannot safely replace');
      return content;
    }

    // Check for semicolon after the closing brace
    let finalEndIndex = endIndex;
    if (content[endIndex] === ';') {
      finalEndIndex++;
    }

    // Extract indentation from the line
    const lineStart = content.lastIndexOf('\n', startIndex) + 1;
    const indent = content.substring(lineStart, startIndex).match(/^(\s*)/)?.[1] ?? '';

    // Format the enhanced spec as TypeScript object literal
    const formattedSpec = this.formatSpecAsTypeScript(enhancedSpec, indent);

    // Build the replacement
    const replacement = `const openApiSpec = ${formattedSpec};`;

    // Replace the old spec with the enhanced one
    const beforeSpec = content.substring(0, startIndex);
    const afterSpec = content.substring(finalEndIndex);

    const result = beforeSpec + replacement + afterSpec;

    this.logger.debug({
      originalLength: content.length,
      resultLength: result.length,
      startIndex,
      endIndex: finalEndIndex,
      specLength: finalEndIndex - startIndex,
    }, 'OpenAPI spec replacement completed');

    return result;
  }

  /**
   * Format OpenAPI spec as TypeScript object literal
   */
  private formatSpecAsTypeScript(spec: Record<string, unknown>, baseIndent: string): string {
    // Remove internal properties
    const cleanSpec = { ...spec };
    delete cleanSpec._rawSpec;
    delete cleanSpec.enhancementNotes;

    // Use JSON.stringify and convert to TypeScript syntax
    const json = JSON.stringify(cleanSpec, null, 2);
    
    // Convert JSON to TypeScript object literal (replace quotes on keys where not needed)
    const ts = json
      .replace(/"([a-zA-Z_][a-zA-Z0-9_]*)"\s*:/g, '$1:')  // Remove quotes from simple keys
      .replace(/\n/g, `\n${baseIndent}`);  // Add base indentation

    return ts;
  }
}
