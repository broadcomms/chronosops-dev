/**
 * Code Validator
 * Validates generated TypeScript code using tsc
 */

import { createChildLogger } from '@chronosops/shared';
import type { GeneratedFile, CodeValidationResult, CodeValidationIssue } from '@chronosops/shared';
import { spawn } from 'node:child_process';
import { writeFile, mkdir, rm, realpath } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import type { CodeValidationPipelineResult, CodeGenerationConfig } from './types.js';
import { DEFAULT_CODE_GENERATION_CONFIG } from './types.js';
import { fastValidator, autoFixer } from './fast-validator.js';

export class CodeValidator {
  private config: CodeGenerationConfig;
  private logger = createChildLogger({ component: 'CodeValidator' });

  constructor(config: Partial<CodeGenerationConfig> = {}) {
    this.config = { ...DEFAULT_CODE_GENERATION_CONFIG, ...config };
  }

  /**
   * Validate generated code by running TypeScript compiler
   */
  async validate(files: GeneratedFile[]): Promise<CodeValidationPipelineResult> {
    const startTime = Date.now();

    this.logger.info({ fileCount: files.length }, 'Starting code validation');

    // V2: Fast validation first (<100ms) - catches common errors before expensive TypeScript compilation
    // IMPORTANT: First validate and fix each file individually to avoid cross-file error contamination
    const tsFiles = files.filter(f => f.language === 'typescript' || f.path.endsWith('.ts'));
    for (const file of tsFiles) {
      const fileValidation = fastValidator.validate(file.content, this.config.storageMode);
      // Use hasFixableErrors instead of fixable - this applies fixes even if some errors are non-fixable
      if (!fileValidation.valid && fileValidation.hasFixableErrors) {
        file.content = autoFixer.fix(file.content, fileValidation.errors);
      }
    }
    
    // Then run multi-file validation to check for cross-file issues
    const fastValidation = fastValidator.validateMultiple(
      tsFiles.map(f => ({ path: f.path, content: f.content })),
      this.config.storageMode
    );

    if (!fastValidation.valid) {
      this.logger.warn({
        fastErrorCount: fastValidation.errors.length,
        fixable: fastValidation.fixable,
        hasFixableErrors: fastValidation.hasFixableErrors,
        errors: fastValidation.errors.map(e => e.code),
      }, 'Fast validation caught pattern violations');

      // If no fixable errors remain, return immediately without expensive TypeScript compilation
      if (!fastValidation.hasFixableErrors && fastValidation.errors.length > 0) {
        return this.buildFastValidationResult(files, fastValidation, startTime);
      }
    }

    // Legacy: Detect known anti-patterns (now mostly handled by FastValidator)
    const antiPatternErrors = this.detectAntiPatterns(files);
    if (antiPatternErrors.length > 0) {
      this.logger.warn({
        antiPatternCount: antiPatternErrors.length,
        patterns: antiPatternErrors.map(e => e.message.substring(0, 60)),
      }, 'Anti-patterns detected in generated code');
    }

    // Create temp directory for validation
    // Use realpath to resolve macOS /private symlink (tmpdir() returns /var/... but real path is /private/var/...)
    const rawTempDir = join(tmpdir(), `chronosops-validate-${randomUUID()}`);
    await mkdir(rawTempDir, { recursive: true });
    const tempDir = await realpath(rawTempDir);

    try {
      // Write files to temp directory
      await this.writeFilesToTemp(files, tempDir);

      // Install dependencies for proper type checking
      // This is essential to catch type mismatches involving npm packages like Zod
      await this.installDependencies(tempDir);

      // Run TypeScript compiler
      const tscResult = await this.runTypeScriptCompiler(tempDir);

      // Parse errors
      const typeErrors = this.parseTypeScriptErrors(tscResult.stderr + tscResult.stdout);
      
      // Combine anti-pattern errors with TypeScript errors (anti-patterns first for visibility)
      const allTypeErrors = [...antiPatternErrors, ...typeErrors];

      // Run linting if enabled
      const lintErrors = await this.runLint(tempDir);

      const errorCount = allTypeErrors.filter(e => e.severity === 'error').length +
                        lintErrors.filter(e => e.severity === 'error').length;
      const warningCount = allTypeErrors.filter(e => e.severity === 'warning').length +
                          lintErrors.filter(e => e.severity === 'warning').length;

      const validationResult: CodeValidationResult = {
        valid: errorCount === 0,
        typeErrors: allTypeErrors,
        lintErrors,
        testErrors: [],
        errorCount,
        warningCount,
      };

      this.logger.info({
        valid: validationResult.valid,
        errorCount,
        warningCount,
      }, 'Validation complete');

      return {
        success: true,
        isValid: validationResult.valid,
        validationResult,
        files,
        processingTimeMs: Date.now() - startTime,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error({ error: errorMessage }, 'Validation failed');

      return {
        success: false,
        isValid: false,
        validationResult: {
          valid: false,
          typeErrors: [
            {
              file: 'unknown',
              line: 0,
              column: 0,
              message: errorMessage,
              severity: 'error',
            },
          ],
          lintErrors: [],
          testErrors: [],
          errorCount: 1,
          warningCount: 0,
        },
        files,
        processingTimeMs: Date.now() - startTime,
      };
    } finally {
      // Clean up temp directory
      await this.cleanup(tempDir);
    }
  }

  /**
   * Write files to temp directory for validation
   */
  private async writeFilesToTemp(files: GeneratedFile[], tempDir: string): Promise<void> {
    for (const file of files) {
      const filePath = join(tempDir, file.path);
      const dir = dirname(filePath);

      await mkdir(dir, { recursive: true });
      await writeFile(filePath, file.content, 'utf-8');
    }

    // Ensure tsconfig exists for validation
    const tsconfigPath = join(tempDir, 'tsconfig.json');
    const hasConfig = files.some((f) => f.path === 'tsconfig.json');

    if (!hasConfig) {
      // Use lenient settings for generated code validation
      // this.config.strictMode is available but we use false for generated code
      const tsconfig = {
        compilerOptions: {
          target: 'ES2022',
          module: 'CommonJS',
          moduleResolution: 'Node',
          strict: this.config.strictMode === false ? false : false, // Always lenient for generated code
          esModuleInterop: true,
          skipLibCheck: true,
          noEmit: true,
          noImplicitAny: false,
        },
        include: ['src/**/*'],
      };
      await writeFile(tsconfigPath, JSON.stringify(tsconfig, null, 2), 'utf-8');
    }
  }

  /**
   * Install npm dependencies for proper type checking
   * This is essential to catch type mismatches involving npm packages like Zod
   */
  private async installDependencies(tempDir: string): Promise<void> {
    const packageJsonPath = join(tempDir, 'package.json');
    
    // Check if package.json exists
    const hasPackageJson = await this.fileExists(packageJsonPath);
    
    this.logger.info({ tempDir, hasPackageJson, packageJsonPath }, 'Checking for package.json');
    
    if (!hasPackageJson) {
      this.logger.warn({ packageJsonPath }, 'No package.json found, skipping dependency installation');
      return;
    }

    this.logger.info({ tempDir }, 'Installing dependencies for type validation (npm install)');
    const installStart = Date.now();

    return new Promise((resolve) => {
      // Use npm install with --ignore-scripts for security and speed
      // Note: Don't pass empty [] for args with shell: true to avoid DEP0190 warning
      // V2: Added --include=dev to install @types/* packages even when NODE_ENV=production (GKE)
      const install = spawn('npm install --include=dev --ignore-scripts --no-audit --no-fund', {
        cwd: tempDir,
        shell: true,
      });

      let stderr = '';
      install.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      install.on('close', (code) => {
        const durationMs = Date.now() - installStart;
        if (code === 0) {
          this.logger.info({ durationMs }, 'Dependencies installed successfully');
          resolve();
        } else {
          this.logger.warn({ exitCode: code, stderr, durationMs }, 'npm install failed, continuing without deps');
          // Don't reject - continue validation without deps (legacy behavior)
          resolve();
        }
      });

      install.on('error', (error) => {
        this.logger.warn({ error: error.message }, 'npm install error, continuing without deps');
        resolve();
      });
    });
  }

  /**
   * Check if a file exists
   */
  private async fileExists(filePath: string): Promise<boolean> {
    try {
      const { stat } = await import('node:fs/promises');
      await stat(filePath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Run TypeScript compiler
   */
  private runTypeScriptCompiler(
    cwd: string
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    return new Promise((resolve) => {
      // Note: Don't pass empty [] for args with shell: true to avoid DEP0190 warning
      const tsc = spawn('npx tsc --noEmit --pretty false', {
        cwd,
        shell: true,
      });

      let stdout = '';
      let stderr = '';

      tsc.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      tsc.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      tsc.on('close', (exitCode) => {
        resolve({
          stdout,
          stderr,
          exitCode: exitCode ?? 1,
        });
      });

      tsc.on('error', (error) => {
        resolve({
          stdout,
          stderr: error.message,
          exitCode: 1,
        });
      });
    });
  }

  /**
   * Parse TypeScript compiler errors
   */
  private parseTypeScriptErrors(output: string): CodeValidationIssue[] {
    const issues: CodeValidationIssue[] = [];

    // TypeScript error format: file(line,column): error TSxxxx: message
    const errorRegex = /^(.+)\((\d+),(\d+)\):\s*(error|warning)\s+(TS\d+):\s*(.+)$/gm;

    let match;
    while ((match = errorRegex.exec(output)) !== null) {
      const [, file, line, column, severityStr, code, message] = match;

      issues.push({
        file: file?.replace(/^\.\//, '') ?? 'unknown',
        line: parseInt(line ?? '0', 10),
        column: parseInt(column ?? '0', 10),
        message: message ?? 'Unknown error',
        code: code,
        severity: severityStr === 'warning' ? 'warning' : 'error',
      });
    }

    return issues;
  }

  /**
   * Run ESLint on generated code
   */
  private async runLint(tempDir: string): Promise<CodeValidationIssue[]> {
    try {
      // Create basic eslint config
      const eslintConfig = {
        root: true,
        parser: '@typescript-eslint/parser',
        plugins: ['@typescript-eslint'],
        extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended'],
        env: {
          node: true,
          es2022: true,
        },
        rules: {
          '@typescript-eslint/no-unused-vars': 'error',
          '@typescript-eslint/no-explicit-any': 'warn',
        },
      };

      await writeFile(
        join(tempDir, '.eslintrc.json'),
        JSON.stringify(eslintConfig, null, 2),
        'utf-8'
      );

      const result = await this.runCommand('npx', ['eslint', 'src', '--format', 'json'], tempDir);

      if (result.stdout) {
        try {
          const lintResults = JSON.parse(result.stdout) as Array<{
            filePath: string;
            messages: Array<{
              line: number;
              column: number;
              message: string;
              ruleId: string;
              severity: number;
            }>;
          }>;

          const issues: CodeValidationIssue[] = [];
          for (const file of lintResults) {
            for (const msg of file.messages) {
              issues.push({
                file: file.filePath.replace(tempDir, '').replace(/^\//, ''),
                line: msg.line,
                column: msg.column,
                message: `[${msg.ruleId}] ${msg.message}`,
                rule: msg.ruleId,
                severity: msg.severity === 2 ? 'error' : 'warning',
              });
            }
          }
          return issues;
        } catch {
          return [];
        }
      }

      return [];
    } catch {
      // If ESLint fails (e.g., not installed), return empty array
      return [];
    }
  }

  /**
   * Build validation result from FastValidator output
   * Used for early return when fast validation catches errors
   */
  private buildFastValidationResult(
    files: GeneratedFile[],
    fastResult: { errors: Array<{ code: string; message: string; line?: number; column?: number; fix: string }>; warnings: Array<{ code: string; message: string }> },
    startTime: number
  ): CodeValidationPipelineResult {
    const typeErrors: CodeValidationIssue[] = fastResult.errors.map(e => ({
      file: 'fast-validation',
      line: e.line ?? 0,
      column: e.column ?? 0,
      message: `[${e.code}] ${e.message}. Fix: ${e.fix}`,
      severity: 'error' as const,
    }));

    return {
      success: true,
      isValid: false,
      validationResult: {
        valid: false,
        typeErrors,
        lintErrors: [],
        testErrors: [],
        errorCount: typeErrors.length,
        warningCount: fastResult.warnings.length,
      },
      files,
      processingTimeMs: Date.now() - startTime,
    };
  }

  /**
   * Detect known anti-patterns in generated code before TypeScript compilation
   * This catches common mistakes early and provides better error messages
   */
  private detectAntiPatterns(files: GeneratedFile[]): CodeValidationIssue[] {
    const issues: CodeValidationIssue[] = [];

    for (const file of files) {
      if (file.language !== 'typescript' && !file.path.endsWith('.ts')) continue;

      const lines = file.content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i] ?? '';
        const lineNum = i + 1;

        // Pattern 1: req.body as { prop?: ... } - optional properties in cast
        if (/(?:req|request)\.body\s+as\s+\{[^}]*\?\s*:/.test(line)) {
          issues.push({
            file: file.path,
            line: lineNum,
            column: 0,
            message: 'Anti-pattern: Using "req.body as { prop?: ... }" will cause type errors. Use Zod Schema.parse(req.body) instead.',
            severity: 'error',
          });
        }

        // Pattern 2: req.body as SomeType (direct cast without validation)
        // Match: req.body as CreateUserInput or request.body as UserInput
        // But don't match: .parse(req.body) or Schema.parse(request.body)
        if (/(?:req|request)\.body\s+as\s+[A-Z][a-zA-Z]+(?:Input|Type|Data|Payload|Body|Request)?(?:\s|;|,|\))/.test(line) &&
            !line.includes('.parse(')) {
          issues.push({
            file: file.path,
            line: lineNum,
            column: 0,
            message: 'Anti-pattern: Using "req.body as Type" provides no runtime validation. Use Zod Schema.parse(req.body) instead.',
            severity: 'error',
          });
        }

        // Pattern 3: <Type>req.body (angle bracket cast)
        if (/<[A-Z][a-zA-Z]+>(?:req|request)\.body/.test(line)) {
          issues.push({
            file: file.path,
            line: lineNum,
            column: 0,
            message: 'Anti-pattern: Using "<Type>req.body" provides no runtime validation. Use Zod Schema.parse(req.body) instead.',
            severity: 'error',
          });
        }
      }
    }

    return issues;
  }

  /**
   * Run a shell command and capture output
   */
  private runCommand(
    command: string,
    args: string[],
    cwd: string
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    return new Promise((resolve) => {
      // Combine command and args into single string to avoid DEP0190 warning with shell: true
      const fullCommand = args.length > 0 ? `${command} ${args.join(' ')}` : command;
      const proc = spawn(fullCommand, { cwd, shell: true });

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      proc.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      proc.on('close', (exitCode) => {
        resolve({ stdout, stderr, exitCode: exitCode ?? 1 });
      });

      proc.on('error', () => {
        resolve({ stdout, stderr, exitCode: 1 });
      });
    });
  }

  /**
   * Clean up temp directory
   */
  private async cleanup(tempDir: string): Promise<void> {
    try {
      await rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  }
}
