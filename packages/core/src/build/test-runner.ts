/**
 * Test Runner
 * Executes tests on generated code using Vitest or Jest
 */

import { createChildLogger } from '@chronosops/shared';
import { spawn } from 'node:child_process';
import type {
  TestRunnerConfig,
  TestRunnerResult,
  CoverageResult,
} from './types.js';
import { DEFAULT_TEST_RUNNER_CONFIG } from './types.js';

export class TestRunner {
  private config: TestRunnerConfig;
  private logger = createChildLogger({ component: 'TestRunner' });

  constructor(config: Partial<TestRunnerConfig> = {}) {
    this.config = { ...DEFAULT_TEST_RUNNER_CONFIG, ...config };
  }

  /**
   * Run tests in the given directory
   * @param workDir - The directory containing the tests
   * @param filter - Optional filter pattern for test files (e.g., '--include src/components')
   */
  async run(workDir: string, filter = ''): Promise<TestRunnerResult> {
    const startTime = Date.now();

    this.logger.info({
      workDir,
      framework: this.config.framework,
      requiredCoverage: this.config.requiredCoverage,
      filter: filter || 'all',
    }, 'Running tests');

    try {
      // Run tests with coverage
      const result = await this.executeTests(workDir, filter);

      // Parse results
      const testResults = this.parseTestResults(result.stdout + result.stderr);
      const coverage = this.parseCoverage(result.stdout + result.stderr);

      const success = result.exitCode === 0 &&
                     (coverage?.meetsThreshold ?? true);

      this.logger.info({
        success,
        passed: testResults.passed,
        failed: testResults.failed,
        coverage: coverage?.lines,
      }, 'Test run complete');

      return {
        success,
        passed: testResults.passed,
        failed: testResults.failed,
        skipped: testResults.skipped,
        total: testResults.total,
        coverage,
        output: result.stdout + result.stderr,
        durationMs: Date.now() - startTime,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error({ error: errorMessage }, 'Test run failed');

      return {
        success: false,
        passed: 0,
        failed: 0,
        skipped: 0,
        total: 0,
        error: errorMessage,
        output: '',
        durationMs: Date.now() - startTime,
      };
    }
  }

  /**
   * Execute tests using the configured framework
   * @param workDir - The directory containing the tests
   * @param filter - Optional filter pattern for test files
   */
  private executeTests(
    workDir: string,
    filter = ''
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    return new Promise((resolve) => {
      const command = this.config.framework === 'vitest'
        ? 'npx'
        : 'npx';

      let args = this.config.framework === 'vitest'
        ? [
            'vitest', 'run',
            '--coverage',
            '--reporter=json',
            '--coverage.reporter=json',
            '--coverage.reporter=text',
          ]
        : [
            'jest',
            '--coverage',
            '--json',
            '--outputFile=test-results.json',
          ];

      // Add filter if provided (e.g., for incremental rebuilds)
      if (filter) {
        // Parse filter string and add each pattern
        const filterParts = filter.split(/\s+/).filter(Boolean);
        args = [...args, ...filterParts];
      }

      this.logger.debug({ command, args, filter }, 'Executing test command');

      const proc = spawn(command, args, {
        cwd: workDir,
        shell: true,
        timeout: this.config.timeout,
      });

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      proc.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      proc.on('close', (exitCode) => {
        resolve({
          stdout,
          stderr,
          exitCode: exitCode ?? 1,
        });
      });

      proc.on('error', (error) => {
        resolve({
          stdout,
          stderr: error.message,
          exitCode: 1,
        });
      });
    });
  }

  /**
   * Parse test results from output
   */
  private parseTestResults(output: string): {
    passed: number;
    failed: number;
    skipped: number;
    total: number;
  } {
    let passed = 0;
    let failed = 0;
    let skipped = 0;

    // Try to parse vitest output
    // Format: Tests  2 passed | 1 failed (3)
    const vitestMatch = output.match(
      /Tests?\s+(\d+)\s+passed(?:\s+\|\s+(\d+)\s+failed)?(?:\s+\|\s+(\d+)\s+skipped)?/i
    );
    if (vitestMatch) {
      passed = parseInt(vitestMatch[1] ?? '0', 10);
      failed = parseInt(vitestMatch[2] ?? '0', 10);
      skipped = parseInt(vitestMatch[3] ?? '0', 10);
      return { passed, failed, skipped, total: passed + failed + skipped };
    }

    // Try to parse jest output
    // Format: Tests: 2 passed, 1 failed, 3 total
    const jestMatch = output.match(
      /Tests:\s+(?:(\d+)\s+passed)?[,\s]*(?:(\d+)\s+failed)?[,\s]*(?:(\d+)\s+skipped)?[,\s]*(\d+)\s+total/i
    );
    if (jestMatch) {
      passed = parseInt(jestMatch[1] ?? '0', 10);
      failed = parseInt(jestMatch[2] ?? '0', 10);
      skipped = parseInt(jestMatch[3] ?? '0', 10);
      return { passed, failed, skipped, total: parseInt(jestMatch[4] ?? '0', 10) };
    }

    // Default: try to count pass/fail patterns
    const passCount = (output.match(/✓|PASS/g) ?? []).length;
    const failCount = (output.match(/✗|FAIL/g) ?? []).length;

    return {
      passed: passCount,
      failed: failCount,
      skipped: 0,
      total: passCount + failCount,
    };
  }

  /**
   * Parse coverage from output
   */
  private parseCoverage(output: string): CoverageResult | undefined {
    // Try to parse coverage table output
    // Format: All files |   85.5 |    82.3 |   90.1 |   84.2 |
    const coverageMatch = output.match(
      /All files\s*\|\s*(\d+(?:\.\d+)?)\s*\|\s*(\d+(?:\.\d+)?)\s*\|\s*(\d+(?:\.\d+)?)\s*\|\s*(\d+(?:\.\d+)?)/
    );

    if (coverageMatch) {
      const statements = parseFloat(coverageMatch[1] ?? '0');
      const branches = parseFloat(coverageMatch[2] ?? '0');
      const functions = parseFloat(coverageMatch[3] ?? '0');
      const lines = parseFloat(coverageMatch[4] ?? '0');

      return {
        statements,
        branches,
        functions,
        lines,
        meetsThreshold: lines >= this.config.requiredCoverage,
      };
    }

    // Try alternate format: Coverage: 85.5%
    const simpleMatch = output.match(/(?:Coverage|Lines):\s*(\d+(?:\.\d+)?)\s*%/i);
    if (simpleMatch) {
      const coverage = parseFloat(simpleMatch[1] ?? '0');
      return {
        statements: coverage,
        branches: coverage,
        functions: coverage,
        lines: coverage,
        meetsThreshold: coverage >= this.config.requiredCoverage,
      };
    }

    return undefined;
  }

  /**
   * Check if coverage meets threshold
   */
  checkCoverageThreshold(coverage: CoverageResult): boolean {
    return coverage.lines >= this.config.requiredCoverage;
  }
}
