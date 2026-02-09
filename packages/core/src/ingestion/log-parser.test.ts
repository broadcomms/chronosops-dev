/**
 * LogParser Tests
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { LogParser } from './log-parser.js';
import type { NormalizedLog } from './types.js';

describe('LogParser', () => {
  let parser: LogParser;

  beforeEach(() => {
    parser = new LogParser();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-15T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('detectFormat()', () => {
    it('should detect JSON format', () => {
      const sample = `{"timestamp":"2024-01-15T10:30:00Z","level":"info","message":"Starting server"}
{"timestamp":"2024-01-15T10:30:01Z","level":"error","message":"Connection failed"}`;

      expect(parser.detectFormat(sample)).toBe('json');
    });

    it('should detect Kubernetes format', () => {
      const sample = `[nginx-abc123] 2024-01-15T10:30:00Z INFO Starting server
[nginx-def456] 2024-01-15T10:30:01Z ERROR Connection failed`;

      expect(parser.detectFormat(sample)).toBe('kubernetes');
    });

    it('should return plaintext for empty input', () => {
      expect(parser.detectFormat('')).toBe('plaintext');
    });
  });

  describe('parse() - JSON format', () => {
    it('should parse JSON logs correctly', () => {
      const rawLogs = `{"timestamp":"2024-01-15T11:30:00Z","level":"info","message":"Server started"}
{"timestamp":"2024-01-15T11:30:05Z","level":"error","message":"Database connection failed"}`;

      const logs = parser.parse(rawLogs, 'json', 'test-source');

      expect(logs).toHaveLength(2);
      expect(logs[0]!.message).toBe('Server started');
      expect(logs[0]!.level).toBe('info');
      expect(logs[0]!.source).toBe('test-source');
      expect(logs[1]!.message).toBe('Database connection failed');
      expect(logs[1]!.level).toBe('error');
    });

    it('should handle various timestamp field names', () => {
      const rawLogs = `{"time":"2024-01-15T11:30:00Z","level":"info","msg":"Using time"}
{"@timestamp":"2024-01-15T11:30:01Z","severity":"warning","message":"Using @timestamp"}
{"ts":1705318200000,"lvl":"error","text":"Using ts"}`;

      const logs = parser.parse(rawLogs, 'json', 'test');

      expect(logs).toHaveLength(3);
      expect(logs[0]!.message).toBe('Using time');
      expect(logs[1]!.level).toBe('warn');
      expect(logs[2]!.level).toBe('error');
    });

    it('should extract trace and span IDs', () => {
      const rawLogs = `{"timestamp":"2024-01-15T11:30:00Z","level":"info","message":"Request","trace_id":"abc123","span_id":"def456"}`;

      const logs = parser.parse(rawLogs, 'json', 'test');

      expect(logs[0]!.traceId).toBe('abc123');
      expect(logs[0]!.spanId).toBe('def456');
    });

    it('should skip invalid JSON lines', () => {
      const rawLogs = `{"timestamp":"2024-01-15T11:30:00Z","level":"info","message":"Valid"}
not valid json
{"timestamp":"2024-01-15T11:30:01Z","level":"error","message":"Also valid"}`;

      const logs = parser.parse(rawLogs, 'json', 'test');

      expect(logs).toHaveLength(2);
    });
  });

  describe('parse() - Kubernetes format', () => {
    it('should parse Kubernetes pod logs', () => {
      const rawLogs = `[nginx-abc123] 2024-01-15T11:30:00Z INFO Request received
[nginx-abc123] 2024-01-15T11:30:01Z ERROR Connection timeout`;

      const logs = parser.parse(rawLogs, 'kubernetes', 'k8s');

      expect(logs).toHaveLength(2);
      expect(logs[0]!.podName).toBe('nginx-abc123');
      expect(logs[0]!.level).toBe('info');
      expect(logs[1]!.level).toBe('error');
    });

    it('should handle pod names without brackets', () => {
      const rawLogs = `api-server-xyz789: 2024-01-15T11:30:00Z INFO Starting`;

      const logs = parser.parse(rawLogs, 'kubernetes', 'k8s');

      expect(logs).toHaveLength(1);
      expect(logs[0]!.podName).toBe('api-server-xyz789');
    });
  });

  describe('parse() - Plaintext format', () => {
    it('should parse plaintext logs with timestamps', () => {
      const rawLogs = `2024-01-15T11:30:00Z INFO Application started
2024-01-15T11:30:05Z ERROR Failed to connect`;

      const logs = parser.parse(rawLogs, 'plaintext', 'app');

      expect(logs).toHaveLength(2);
      expect(logs[0]!.level).toBe('info');
      expect(logs[1]!.level).toBe('error');
    });

    it('should detect log levels from keywords', () => {
      // Level keywords are matched with word boundary patterns
      const rawLogs = `2024-01-15T11:30:00Z [FATAL] system crash
2024-01-15T11:30:01Z [WARN] memory low`;

      const logs = parser.parse(rawLogs, 'plaintext', 'app');

      expect(logs[0]!.level).toBe('fatal');
      expect(logs[1]!.level).toBe('warn');
    });

    it('should handle stack traces', () => {
      const rawLogs = `2024-01-15T11:30:00Z ERROR TypeError: undefined is not a function
    at processRequest (/app/handler.js:45)
    at Server.handleRequest (/app/server.js:120)
2024-01-15T11:30:01Z INFO Next log entry`;

      const logs = parser.parse(rawLogs, 'plaintext', 'app');

      expect(logs).toHaveLength(2);
      expect(logs[0]!.stackTrace).toContain('at processRequest');
      expect(logs[0]!.stackTrace).toContain('at Server.handleRequest');
    });

    it('should extract error types', () => {
      // errorType is only extracted from error/fatal level logs
      const rawLogs = `2024-01-15T11:30:00Z ERROR TypeError: Cannot read property
2024-01-15T11:30:01Z error ConnectionException: timeout`;

      const logs = parser.parse(rawLogs, 'plaintext', 'app');

      expect(logs[0]!.level).toBe('error');
      expect(logs[0]!.errorType).toBe('TypeError');
      expect(logs[1]!.errorType).toBe('ConnectionException');
    });
  });

  describe('parse() - timestamp handling', () => {
    it('should handle ISO 8601 timestamps', () => {
      const rawLogs = `2024-01-15T11:30:00.123Z INFO Test`;
      const logs = parser.parse(rawLogs, 'plaintext', 'test');

      expect(logs[0]!.timestamp.toISOString()).toContain('2024-01-15T11:30:00');
    });

    it('should handle unix timestamp in seconds', () => {
      const rawLogs = `{"timestamp":1705318200,"level":"info","message":"Unix seconds"}`;
      const logs = parser.parse(rawLogs, 'json', 'test');

      expect(logs[0]!.timestamp.getFullYear()).toBe(2024);
    });

    it('should handle unix timestamp in milliseconds', () => {
      const rawLogs = `{"timestamp":1705318200000,"level":"info","message":"Unix ms"}`;
      const logs = parser.parse(rawLogs, 'json', 'test');

      expect(logs[0]!.timestamp.getFullYear()).toBe(2024);
    });
  });

  describe('parse() - log age filtering', () => {
    it('should filter out logs older than maxLogAge', () => {
      // With system time at 2024-01-15T12:00:00Z and default maxLogAge of 1 hour
      const rawLogs = `{"timestamp":"2024-01-15T11:30:00Z","level":"info","message":"Within 1 hour"}
{"timestamp":"2024-01-15T10:00:00Z","level":"info","message":"Exactly 2 hours old"}`;

      const logs = parser.parse(rawLogs, 'json', 'test');

      expect(logs).toHaveLength(1);
      expect(logs[0]!.message).toBe('Within 1 hour');
    });
  });

  describe('extractErrors()', () => {
    it('should extract and aggregate error logs', () => {
      const logs: NormalizedLog[] = [
        { id: '1', timestamp: new Date(), level: 'error', source: 'app', message: 'Connection failed', metadata: {}, raw: '', errorType: 'ConnectionError' },
        { id: '2', timestamp: new Date(), level: 'error', source: 'app', message: 'Connection failed', metadata: {}, raw: '', errorType: 'ConnectionError' },
        { id: '3', timestamp: new Date(), level: 'info', source: 'app', message: 'Request received', metadata: {}, raw: '' },
        { id: '4', timestamp: new Date(), level: 'fatal', source: 'app', message: 'System crash', metadata: {}, raw: '', errorType: 'SystemError' },
      ];

      const errors = parser.extractErrors(logs);

      expect(errors).toHaveLength(2);
      expect(errors[0]!.occurrences).toBe(2); // ConnectionError appeared twice
      expect(errors[0]!.errorType).toBe('ConnectionError');
    });

    it('should track affected pods', () => {
      const logs: NormalizedLog[] = [
        { id: '1', timestamp: new Date(), level: 'error', source: 'app', message: 'Error', metadata: {}, raw: '', podName: 'pod-1' },
        { id: '2', timestamp: new Date(), level: 'error', source: 'app', message: 'Error', metadata: {}, raw: '', podName: 'pod-2' },
        { id: '3', timestamp: new Date(), level: 'error', source: 'app', message: 'Error', metadata: {}, raw: '', podName: 'pod-1' },
      ];

      const errors = parser.extractErrors(logs);

      expect(errors[0]!.affectedPods).toContain('pod-1');
      expect(errors[0]!.affectedPods).toContain('pod-2');
    });
  });

  describe('groupByTimeWindow()', () => {
    it('should group logs by time window', () => {
      const now = new Date();
      const logs: NormalizedLog[] = [
        { id: '1', timestamp: new Date(now.getTime()), level: 'info', source: 'app', message: 'Msg 1', metadata: {}, raw: '' },
        { id: '2', timestamp: new Date(now.getTime() + 5000), level: 'info', source: 'app', message: 'Msg 2', metadata: {}, raw: '' },
        { id: '3', timestamp: new Date(now.getTime() + 60000), level: 'error', source: 'app', message: 'Msg 3', metadata: {}, raw: '' },
      ];

      const groups = parser.groupByTimeWindow(logs, 30000);

      expect(groups).toHaveLength(2);
      expect(groups[0]!.logs).toHaveLength(2);
      expect(groups[1]!.logs).toHaveLength(1);
    });

    it('should return empty array for empty logs', () => {
      const groups = parser.groupByTimeWindow([]);
      expect(groups).toHaveLength(0);
    });

    it('should calculate error and warn counts', () => {
      const now = new Date();
      const logs: NormalizedLog[] = [
        { id: '1', timestamp: now, level: 'error', source: 'app', message: 'Error', metadata: {}, raw: '' },
        { id: '2', timestamp: now, level: 'warn', source: 'app', message: 'Warn', metadata: {}, raw: '' },
        { id: '3', timestamp: now, level: 'fatal', source: 'app', message: 'Fatal', metadata: {}, raw: '' },
      ];

      const groups = parser.groupByTimeWindow(logs, 60000);

      expect(groups[0]!.errorCount).toBe(2); // error + fatal
      expect(groups[0]!.warnCount).toBe(1);
    });
  });

  describe('findMatching()', () => {
    it('should find logs matching a string pattern', () => {
      const logs: NormalizedLog[] = [
        { id: '1', timestamp: new Date(), level: 'info', source: 'app', message: 'User login successful', metadata: {}, raw: '' },
        { id: '2', timestamp: new Date(), level: 'error', source: 'app', message: 'Database query failed', metadata: {}, raw: '' },
        { id: '3', timestamp: new Date(), level: 'info', source: 'app', message: 'User logout', metadata: {}, raw: '' },
      ];

      const matches = parser.findMatching(logs, 'user');

      expect(matches).toHaveLength(2);
    });

    it('should find logs matching a regex pattern', () => {
      const logs: NormalizedLog[] = [
        { id: '1', timestamp: new Date(), level: 'error', source: 'app', message: 'Error code: 500', metadata: {}, raw: '' },
        { id: '2', timestamp: new Date(), level: 'error', source: 'app', message: 'Error code: 404', metadata: {}, raw: '' },
      ];

      const matches = parser.findMatching(logs, /error code: 5\d{2}/i);

      expect(matches).toHaveLength(1);
    });
  });

  describe('detectErrorSpikes()', () => {
    it('should detect error spikes above baseline', () => {
      const baseTime = new Date('2024-01-15T11:30:00Z').getTime();
      const logs: NormalizedLog[] = [];

      // Create baseline: 1 error per 30 second window for 5 windows
      for (let window = 0; window < 5; window++) {
        logs.push({
          id: `base-${window}`,
          timestamp: new Date(baseTime + window * 30000),
          level: 'error',
          source: 'app',
          message: 'Normal error',
          metadata: {},
          raw: '',
          errorType: 'BaseError',
        });
      }

      // Create spike: 10 errors in one window
      for (let i = 0; i < 10; i++) {
        logs.push({
          id: `spike-${i}`,
          timestamp: new Date(baseTime + 5 * 30000 + i * 1000),
          level: 'error',
          source: 'app',
          message: 'Spike error',
          metadata: {},
          raw: '',
          errorType: 'SpikeError',
        });
      }

      const spikes = parser.detectErrorSpikes(logs, 2.0);

      expect(spikes.length).toBeGreaterThan(0);
      expect(spikes.some(s => s.types.includes('SpikeError'))).toBe(true);
    });

    it('should return empty for uniform error rate', () => {
      const baseTime = new Date('2024-01-15T11:30:00Z').getTime();
      const logs: NormalizedLog[] = [];

      // Create uniform: 2 errors per 30 second window
      for (let window = 0; window < 5; window++) {
        for (let i = 0; i < 2; i++) {
          logs.push({
            id: `log-${window}-${i}`,
            timestamp: new Date(baseTime + window * 30000 + i * 10000),
            level: 'error',
            source: 'app',
            message: 'Uniform error',
            metadata: {},
            raw: '',
          });
        }
      }

      const spikes = parser.detectErrorSpikes(logs, 2.0);

      expect(spikes).toHaveLength(0);
    });
  });

  describe('parseKubernetesLogs()', () => {
    it('should parse kubectl output and set pod name', () => {
      const kubectlOutput = `2024-01-15T11:30:00Z INFO Starting application
2024-01-15T11:30:01Z ERROR Failed to connect to database`;

      const logs = parser.parseKubernetesLogs(kubectlOutput, 'my-pod-abc123');

      expect(logs).toHaveLength(2);
      expect(logs[0]!.podName).toBe('my-pod-abc123');
      expect(logs[1]!.podName).toBe('my-pod-abc123');
    });
  });

  describe('analyze()', () => {
    it('should return comprehensive analysis result', () => {
      const rawLogs = `{"timestamp":"2024-01-15T11:30:00Z","level":"info","message":"Started"}
{"timestamp":"2024-01-15T11:30:01Z","level":"error","message":"Connection failed"}
{"timestamp":"2024-01-15T11:30:02Z","level":"warn","message":"High latency"}`;

      const result = parser.analyze(rawLogs, 'test-app');

      expect(result.logs).toHaveLength(3);
      expect(result.errors).toHaveLength(1);
      expect(result.summary.totalLogs).toBe(3);
      expect(result.summary.errorCount).toBe(1);
      expect(result.summary.warnCount).toBe(1);
      expect(result.summary.dominantLevel).toBe('error');
    });
  });
});
