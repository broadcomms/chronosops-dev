/**
 * Log Parser
 * Parses and normalizes logs from multiple sources for correlation
 */

import { randomUUID } from 'crypto';
import { createChildLogger } from '@chronosops/shared';
import type {
  NormalizedLog,
  LogFormat,
  LogLevel,
  LogGroup,
  ErrorLog,
  ErrorSpike,
  LogParserConfig,
  LogParserResult,
} from './types.js';

const DEFAULT_CONFIG: LogParserConfig = {
  maxLogAge: 3600000,        // 1 hour
  batchSize: 1000,
  errorPatterns: [
    /error/i,
    /exception/i,
    /failed/i,
    /fatal/i,
    /panic/i,
    /crash/i,
  ],
  spikeThreshold: 2.0,       // 2x baseline = spike
  timeWindowMs: 30000,       // 30 seconds
};

// Common timestamp patterns
const TIMESTAMP_PATTERNS = [
  // ISO 8601
  /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)/,
  // Common log format: 2024-01-15 10:30:45
  /^(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}(?:\.\d+)?)/,
  // Kubernetes format: 2024-01-15T10:30:45.123456789Z
  /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z)/,
  // Unix timestamp (seconds or milliseconds)
  /^(\d{10,13})\s/,
];

// Log level patterns
const LEVEL_PATTERNS: Array<{ pattern: RegExp; level: LogLevel }> = [
  { pattern: /\b(fatal|crit(?:ical)?)\b/i, level: 'fatal' },
  { pattern: /\b(err(?:or)?|fail(?:ed)?|exception)\b/i, level: 'error' },
  { pattern: /\b(warn(?:ing)?)\b/i, level: 'warn' },
  { pattern: /\b(info(?:rmation)?)\b/i, level: 'info' },
  { pattern: /\b(debug|trace|verbose)\b/i, level: 'debug' },
];

// Stack trace patterns
const STACK_TRACE_PATTERNS = [
  /^\s+at\s+/,           // JavaScript/Java style
  /^\s+File\s+"/,        // Python style
  /^\s+\d+:\s/,          // Go style with line numbers
  /Traceback \(most recent call last\)/i,
];

export class LogParser {
  private config: LogParserConfig;
  private logger = createChildLogger({ component: 'LogParser' });

  constructor(config: Partial<LogParserConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Parse raw logs into normalized format
   */
  parse(rawLogs: string, format?: LogFormat, source: string = 'unknown'): NormalizedLog[] {
    const detectedFormat = format === 'auto' || !format ? this.detectFormat(rawLogs) : format;
    const lines = rawLogs.split('\n').filter((line) => line.trim());
    const logs: NormalizedLog[] = [];
    const now = Date.now();
    let currentStackTrace: string[] = [];
    let lastLog: NormalizedLog | null = null;

    this.logger.debug({
      format: detectedFormat,
      lineCount: lines.length,
      source,
    }, 'Parsing logs');

    for (const line of lines) {
      // Check if this is a stack trace continuation
      if (this.isStackTraceLine(line) && lastLog) {
        currentStackTrace.push(line);
        continue;
      }

      // If we have accumulated stack trace, attach it to last log
      if (currentStackTrace.length > 0 && lastLog) {
        lastLog.stackTrace = currentStackTrace.join('\n');
        currentStackTrace = [];
      }

      // Parse the line based on format
      let parsed: NormalizedLog | null = null;

      switch (detectedFormat) {
        case 'json':
          parsed = this.parseJsonLine(line, source);
          break;
        case 'kubernetes':
          parsed = this.parseKubernetesLine(line, source);
          break;
        case 'plaintext':
        default:
          parsed = this.parsePlaintextLine(line, source);
      }

      if (parsed) {
        // Filter out logs older than maxLogAge
        if (now - parsed.timestamp.getTime() <= this.config.maxLogAge) {
          logs.push(parsed);
          lastLog = parsed;
        }
      }
    }

    // Attach any remaining stack trace
    if (currentStackTrace.length > 0 && lastLog) {
      lastLog.stackTrace = currentStackTrace.join('\n');
    }

    this.logger.info({
      totalParsed: logs.length,
      format: detectedFormat,
    }, 'Log parsing complete');

    return logs;
  }

  /**
   * Detect log format from sample
   */
  detectFormat(sample: string): LogFormat {
    const lines = sample.split('\n').filter((line) => line.trim()).slice(0, 10);

    if (lines.length === 0) {
      return 'plaintext';
    }

    // Check for JSON format
    let jsonCount = 0;
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
        try {
          JSON.parse(trimmed);
          jsonCount++;
        } catch {
          // Not valid JSON
        }
      }
    }
    if (jsonCount >= lines.length * 0.7) {
      return 'json';
    }

    // Check for Kubernetes format (pod name prefix)
    // Example: [nginx-deployment-abc123] or nginx-deployment-abc123:
    const k8sPattern = /^\[?[a-z0-9-]+(?:-[a-z0-9]+)*\]?:?\s/i;
    let k8sCount = 0;
    for (const line of lines) {
      if (k8sPattern.test(line)) {
        k8sCount++;
      }
    }
    if (k8sCount >= lines.length * 0.5) {
      return 'kubernetes';
    }

    return 'plaintext';
  }

  /**
   * Parse JSON log line
   */
  private parseJsonLine(line: string, source: string): NormalizedLog | null {
    try {
      const obj = JSON.parse(line.trim()) as Record<string, unknown>;

      // Extract timestamp from various common fields
      const timestampValue = obj.timestamp ?? obj.time ?? obj['@timestamp'] ?? obj.ts;
      const timestamp = this.parseTimestamp(timestampValue);

      // Extract level from various common fields
      const levelValue = obj.level ?? obj.severity ?? obj.lvl ?? obj.log_level;
      const level = this.normalizeLevel(String(levelValue ?? 'info'));

      // Extract message
      const message = String(obj.message ?? obj.msg ?? obj.log ?? obj.text ?? '');

      // Extract trace IDs if present
      const traceId = obj.trace_id ?? obj.traceId ?? obj['x-trace-id'];
      const spanId = obj.span_id ?? obj.spanId ?? obj['x-span-id'];

      // Extract error type if present
      const errorType = obj.error_type ?? obj.errorType ?? obj.exception_type;

      return {
        id: randomUUID(),
        timestamp,
        level,
        source,
        message,
        metadata: obj,
        raw: line,
        errorType: errorType ? String(errorType) : undefined,
        traceId: traceId ? String(traceId) : undefined,
        spanId: spanId ? String(spanId) : undefined,
        podName: obj.pod_name ? String(obj.pod_name) : undefined,
        containerName: obj.container_name ? String(obj.container_name) : undefined,
      };
    } catch (error) {
      this.logger.debug({ line: line.substring(0, 100) }, 'Failed to parse JSON line');
      return null;
    }
  }

  /**
   * Parse Kubernetes log line
   * Format: [pod-name] timestamp level message
   * or: pod-name timestamp level message
   */
  private parseKubernetesLine(line: string, source: string): NormalizedLog | null {
    // Match patterns like: [nginx-abc123] or nginx-abc123:
    const podMatch = line.match(/^\[?([a-z0-9-]+(?:-[a-z0-9]+)*)\]?:?\s*/i);

    let podName: string | undefined;
    let remainingLine = line;

    if (podMatch) {
      podName = podMatch[1];
      remainingLine = line.slice(podMatch[0].length);
    }

    // Parse the remaining content as plaintext
    const parsed = this.parsePlaintextLine(remainingLine, source);

    if (parsed) {
      parsed.podName = podName;
      parsed.metadata.podName = podName;
    }

    return parsed;
  }

  /**
   * Parse plaintext log line
   */
  private parsePlaintextLine(line: string, source: string): NormalizedLog | null {
    if (!line.trim()) {
      return null;
    }

    let timestamp = new Date();
    let remainingLine = line;

    // Try to extract timestamp
    for (const pattern of TIMESTAMP_PATTERNS) {
      const match = line.match(pattern);
      if (match?.[1]) {
        timestamp = this.parseTimestamp(match[1]);
        remainingLine = line.slice(match[0].length).trim();
        break;
      }
    }

    // Extract level
    const level = this.extractLevel(remainingLine);

    // Extract error type if this is an error
    let errorType: string | undefined;
    if (level === 'error' || level === 'fatal') {
      errorType = this.extractErrorType(remainingLine);
    }

    return {
      id: randomUUID(),
      timestamp,
      level,
      source,
      message: remainingLine,
      metadata: {},
      raw: line,
      errorType,
    };
  }

  /**
   * Parse timestamp from various formats
   */
  private parseTimestamp(value: unknown): Date {
    if (!value) {
      return new Date();
    }

    if (value instanceof Date) {
      return value;
    }

    if (typeof value === 'number') {
      // Unix timestamp - check if seconds or milliseconds
      if (value < 1e12) {
        return new Date(value * 1000);
      }
      return new Date(value);
    }

    if (typeof value === 'string') {
      // Try ISO format first
      const isoDate = new Date(value);
      if (!isNaN(isoDate.getTime())) {
        return isoDate;
      }

      // Try unix timestamp string
      const numValue = parseInt(value, 10);
      if (!isNaN(numValue)) {
        if (numValue < 1e12) {
          return new Date(numValue * 1000);
        }
        return new Date(numValue);
      }
    }

    return new Date();
  }

  /**
   * Extract log level from line
   */
  private extractLevel(line: string): LogLevel {
    for (const { pattern, level } of LEVEL_PATTERNS) {
      if (pattern.test(line)) {
        return level;
      }
    }
    return 'info';
  }

  /**
   * Normalize level string to LogLevel type
   */
  private normalizeLevel(level: string): LogLevel {
    const normalized = level.toLowerCase().trim();

    if (normalized.includes('fatal') || normalized.includes('crit')) {
      return 'fatal';
    }
    if (normalized.includes('err') || normalized.includes('fail')) {
      return 'error';
    }
    if (normalized.includes('warn')) {
      return 'warn';
    }
    if (normalized.includes('debug') || normalized.includes('trace')) {
      return 'debug';
    }

    return 'info';
  }

  /**
   * Check if a line is part of a stack trace
   */
  private isStackTraceLine(line: string): boolean {
    return STACK_TRACE_PATTERNS.some((pattern) => pattern.test(line));
  }

  /**
   * Extract error type from error message
   */
  private extractErrorType(message: string): string {
    // Common error patterns
    const patterns = [
      /(\w+Error):/,           // JavaScript/Python errors
      /(\w+Exception):/,       // Java exceptions
      /panic:\s*(\w+)/,        // Go panics
      /FATAL:\s*(\w+)/,        // Fatal errors
      /ERROR\s+(\w+)/,         // Generic ERROR TYPE format
    ];

    for (const pattern of patterns) {
      const match = message.match(pattern);
      if (match?.[1]) {
        return match[1];
      }
    }

    return 'UnknownError';
  }

  /**
   * Extract error logs with aggregation
   */
  extractErrors(logs: NormalizedLog[]): ErrorLog[] {
    const errorLogs = logs.filter(
      (log) => log.level === 'error' || log.level === 'fatal'
    );

    // Group by error type and message similarity
    const errorGroups = new Map<string, NormalizedLog[]>();

    for (const log of errorLogs) {
      // Create a key based on error type and first 100 chars of message
      const key = `${log.errorType ?? 'unknown'}:${log.message.substring(0, 100)}`;
      const existing = errorGroups.get(key) ?? [];
      existing.push(log);
      errorGroups.set(key, existing);
    }

    // Convert groups to ErrorLog format
    const result: ErrorLog[] = [];

    for (const [, groupLogs] of errorGroups) {
      const firstLog = groupLogs[0];
      if (!firstLog) continue;

      const pods = new Set<string>();
      for (const log of groupLogs) {
        if (log.podName) {
          pods.add(log.podName);
        }
      }

      result.push({
        ...firstLog,
        level: firstLog.level as 'error' | 'fatal',
        errorType: firstLog.errorType ?? 'UnknownError',
        occurrences: groupLogs.length,
        firstSeen: new Date(Math.min(...groupLogs.map((l) => l.timestamp.getTime()))),
        lastSeen: new Date(Math.max(...groupLogs.map((l) => l.timestamp.getTime()))),
        affectedPods: Array.from(pods),
      });
    }

    // Sort by occurrence count descending
    result.sort((a, b) => b.occurrences - a.occurrences);

    return result;
  }

  /**
   * Group logs by time window for correlation
   */
  groupByTimeWindow(logs: NormalizedLog[], windowMs?: number): LogGroup[] {
    const window = windowMs ?? this.config.timeWindowMs;

    if (logs.length === 0) {
      return [];
    }

    // Sort by timestamp
    const sorted = [...logs].sort(
      (a, b) => a.timestamp.getTime() - b.timestamp.getTime()
    );

    const groups: LogGroup[] = [];
    let currentGroup: NormalizedLog[] = [];
    let groupStartTime = sorted[0]!.timestamp.getTime();

    for (const log of sorted) {
      const logTime = log.timestamp.getTime();

      if (logTime - groupStartTime > window) {
        // Start new group
        if (currentGroup.length > 0) {
          groups.push(this.createLogGroup(currentGroup));
        }
        currentGroup = [log];
        groupStartTime = logTime;
      } else {
        currentGroup.push(log);
      }
    }

    // Add final group
    if (currentGroup.length > 0) {
      groups.push(this.createLogGroup(currentGroup));
    }

    return groups;
  }

  /**
   * Create a LogGroup from logs
   */
  private createLogGroup(logs: NormalizedLog[]): LogGroup {
    const levelCounts = { debug: 0, info: 0, warn: 0, error: 0, fatal: 0 };

    for (const log of logs) {
      levelCounts[log.level]++;
    }

    // Find dominant level (most frequent non-info level, or info)
    let dominantLevel: LogLevel = 'info';
    let maxCount = 0;

    for (const level of ['fatal', 'error', 'warn', 'debug'] as LogLevel[]) {
      if (levelCounts[level] > maxCount) {
        maxCount = levelCounts[level];
        dominantLevel = level;
      }
    }

    if (maxCount === 0) {
      dominantLevel = 'info';
    }

    return {
      startTime: logs[0]!.timestamp,
      endTime: logs[logs.length - 1]!.timestamp,
      logs,
      errorCount: levelCounts.error + levelCounts.fatal,
      warnCount: levelCounts.warn,
      dominantLevel,
    };
  }

  /**
   * Find logs matching a pattern
   */
  findMatching(logs: NormalizedLog[], pattern: string | RegExp): NormalizedLog[] {
    const regex = typeof pattern === 'string' ? new RegExp(pattern, 'i') : pattern;

    return logs.filter((log) =>
      regex.test(log.message) || regex.test(log.raw)
    );
  }

  /**
   * Detect error spike periods
   */
  detectErrorSpikes(logs: NormalizedLog[], threshold?: number): ErrorSpike[] {
    const spikeThreshold = threshold ?? this.config.spikeThreshold;
    const windowMs = this.config.timeWindowMs;

    // Group logs into time windows
    const groups = this.groupByTimeWindow(logs, windowMs);

    if (groups.length < 2) {
      return [];
    }

    // Calculate baseline error rate (median of all windows)
    const errorRates = groups.map(
      (g) => g.errorCount / (windowMs / 1000) // errors per second
    );
    const sortedRates = [...errorRates].sort((a, b) => a - b);
    const baselineRate = sortedRates[Math.floor(sortedRates.length / 2)]!;

    // Find spikes
    const spikes: ErrorSpike[] = [];

    for (let i = 0; i < groups.length; i++) {
      const group = groups[i]!;
      const rate = errorRates[i]!;

      if (baselineRate > 0 && rate > baselineRate * spikeThreshold) {
        const errorLogs = group.logs.filter(
          (l) => l.level === 'error' || l.level === 'fatal'
        );

        // Get unique error types
        const types = new Set<string>();
        for (const log of errorLogs) {
          if (log.errorType) {
            types.add(log.errorType);
          }
        }

        spikes.push({
          start: group.startTime,
          end: group.endTime,
          count: group.errorCount,
          baselineRate,
          spikeRate: rate,
          types: Array.from(types),
          samples: errorLogs.slice(0, 5), // Keep first 5 samples
        });
      }
    }

    return spikes;
  }

  /**
   * Parse Kubernetes pod logs from kubectl output
   */
  parseKubernetesLogs(kubectlOutput: string, podName: string): NormalizedLog[] {
    const logs = this.parse(kubectlOutput, 'auto', `kubectl:${podName}`);

    // Ensure all logs have the pod name set
    for (const log of logs) {
      log.podName = podName;
      log.metadata.podName = podName;
    }

    return logs;
  }

  /**
   * Run full log analysis and return comprehensive result
   */
  analyze(rawLogs: string, source: string = 'unknown'): LogParserResult {
    const logs = this.parse(rawLogs, 'auto', source);
    const errors = this.extractErrors(logs);
    const groups = this.groupByTimeWindow(logs);
    const spikes = this.detectErrorSpikes(logs);

    // Calculate summary
    const levelCounts = { debug: 0, info: 0, warn: 0, error: 0, fatal: 0 };
    for (const log of logs) {
      levelCounts[log.level]++;
    }

    let dominantLevel: LogLevel = 'info';
    if (levelCounts.fatal > 0) dominantLevel = 'fatal';
    else if (levelCounts.error > 0) dominantLevel = 'error';
    else if (levelCounts.warn > 0) dominantLevel = 'warn';

    const timestamps = logs.map((l) => l.timestamp.getTime());
    const timeRange = {
      start: new Date(Math.min(...timestamps, Date.now())),
      end: new Date(Math.max(...timestamps, Date.now())),
    };

    return {
      logs,
      errors,
      groups,
      spikes,
      summary: {
        totalLogs: logs.length,
        errorCount: levelCounts.error + levelCounts.fatal,
        warnCount: levelCounts.warn,
        timeRange,
        dominantLevel,
      },
    };
  }
}
