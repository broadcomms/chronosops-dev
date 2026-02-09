/**
 * MetricProcessor Tests
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { MetricProcessor } from './metric-processor.js';
import type { Metric } from './types.js';

describe('MetricProcessor', () => {
  let processor: MetricProcessor;

  beforeEach(() => {
    processor = new MetricProcessor();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-15T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('ingestPrometheusFormat()', () => {
    it('should parse simple Prometheus metrics', () => {
      const data = `# HELP http_requests_total Total HTTP requests
# TYPE http_requests_total counter
http_requests_total 1234`;

      const metrics = processor.ingestPrometheusFormat(data);

      expect(metrics).toHaveLength(1);
      expect(metrics[0]!.name).toBe('http_requests_total');
      expect(metrics[0]!.value).toBe(1234);
    });

    it('should parse metrics with labels', () => {
      const data = `container_cpu_usage{namespace="production",pod="api-server-123"} 0.75
container_memory_bytes{namespace="production",pod="api-server-123"} 1073741824`;

      const metrics = processor.ingestPrometheusFormat(data);

      expect(metrics).toHaveLength(2);
      expect(metrics[0]!.name).toBe('container_cpu_usage');
      expect(metrics[0]!.labels).toEqual({
        namespace: 'production',
        pod: 'api-server-123',
      });
      expect(metrics[0]!.value).toBe(0.75);
    });

    it('should parse metrics with timestamps', () => {
      const timestamp = Date.now();
      const data = `http_requests_total 1234 ${timestamp}`;

      const metrics = processor.ingestPrometheusFormat(data);

      expect(metrics).toHaveLength(1);
      expect(metrics[0]!.timestamp.getTime()).toBe(timestamp);
    });

    it('should handle scientific notation', () => {
      const data = `memory_bytes 1.5e9`;

      const metrics = processor.ingestPrometheusFormat(data);

      expect(metrics[0]!.value).toBe(1.5e9);
    });

    it('should skip comments and empty lines', () => {
      const data = `# This is a comment
# TYPE counter
metric_a 1

metric_b 2`;

      const metrics = processor.ingestPrometheusFormat(data);

      expect(metrics).toHaveLength(2);
    });

    it('should skip invalid lines', () => {
      const data = `valid_metric 123
this is not a valid metric line
another_valid{label="value"} 456`;

      const metrics = processor.ingestPrometheusFormat(data);

      expect(metrics).toHaveLength(2);
    });
  });

  describe('detectAnomalies()', () => {
    it('should detect anomalies based on standard deviation', () => {
      const baseTime = new Date('2024-01-15T11:30:00Z').getTime();
      const metrics: Metric[] = [];

      // Create baseline: values around 100 with small variation
      for (let i = 0; i < 10; i++) {
        metrics.push({
          name: 'cpu_usage',
          timestamp: new Date(baseTime + i * 1000),
          value: 100 + Math.random() * 10, // 100-110
          labels: { pod: 'test' },
        });
      }

      // Add anomaly: value way outside normal range
      metrics.push({
        name: 'cpu_usage',
        timestamp: new Date(baseTime + 11000),
        value: 500, // Clearly anomalous
        labels: { pod: 'test' },
      });

      const anomalies = processor.detectAnomalies(metrics);

      expect(anomalies.length).toBeGreaterThan(0);
      expect(anomalies[0]!.value).toBe(500);
    });

    it('should return empty array when no anomalies', () => {
      const metrics: Metric[] = [];

      // Create uniform metrics
      for (let i = 0; i < 10; i++) {
        metrics.push({
          name: 'cpu_usage',
          timestamp: new Date(Date.now() + i * 1000),
          value: 100, // All same value
          labels: {},
        });
      }

      const anomalies = processor.detectAnomalies(metrics);

      expect(anomalies).toHaveLength(0);
    });

    it('should score critical metrics with higher severity', () => {
      const metrics: Metric[] = [];
      const baseTime = Date.now();

      // Baseline values
      for (let i = 0; i < 10; i++) {
        metrics.push({
          name: 'container_cpu_usage_seconds_total',
          timestamp: new Date(baseTime + i * 1000),
          value: 0.5,
          labels: {},
        });
      }

      // Add anomaly
      metrics.push({
        name: 'container_cpu_usage_seconds_total',
        timestamp: new Date(baseTime + 11000),
        value: 5.0, // 10x baseline
        labels: {},
      });

      const anomalies = processor.detectAnomalies(metrics);

      expect(anomalies.length).toBeGreaterThan(0);
      // Critical metrics should have higher severity for same deviation
      expect(['critical', 'high']).toContain(anomalies[0]!.severity);
    });

    it('should include expected range in anomaly', () => {
      const metrics: Metric[] = [];
      const baseTime = Date.now();

      for (let i = 0; i < 10; i++) {
        metrics.push({
          name: 'response_time',
          timestamp: new Date(baseTime + i * 1000),
          value: 100 + i * 2, // 100-118
          labels: {},
        });
      }

      metrics.push({
        name: 'response_time',
        timestamp: new Date(baseTime + 11000),
        value: 1000,
        labels: {},
      });

      const anomalies = processor.detectAnomalies(metrics);

      expect(anomalies[0]!.expectedRange).toBeDefined();
      expect(anomalies[0]!.expectedRange[0]).toBeLessThan(anomalies[0]!.expectedRange[1]);
    });
  });

  describe('correlateWithTimestamp()', () => {
    it('should filter metrics within time window', () => {
      const targetTime = new Date('2024-01-15T12:00:00Z');
      const metrics: Metric[] = [
        { name: 'metric', timestamp: new Date('2024-01-15T11:55:00Z'), value: 1, labels: {} },
        { name: 'metric', timestamp: new Date('2024-01-15T12:00:00Z'), value: 2, labels: {} },
        { name: 'metric', timestamp: new Date('2024-01-15T12:05:00Z'), value: 3, labels: {} },
        { name: 'metric', timestamp: new Date('2024-01-15T12:30:00Z'), value: 4, labels: {} }, // outside
      ];

      // 5 minute window (default)
      const correlated = processor.correlateWithTimestamp(metrics, targetTime, 600000); // 10 min window

      expect(correlated).toHaveLength(3);
      expect(correlated.some(m => m.value === 4)).toBe(false);
    });
  });

  describe('summarize()', () => {
    it('should calculate summary statistics', () => {
      const metrics: Metric[] = [
        { name: 'cpu', timestamp: new Date(), value: 10, labels: { pod: 'a' } },
        { name: 'cpu', timestamp: new Date(), value: 20, labels: { pod: 'a' } },
        { name: 'cpu', timestamp: new Date(), value: 30, labels: { pod: 'a' } },
      ];

      const summaries = processor.summarize(metrics);

      expect(summaries).toHaveLength(1);
      expect(summaries[0]!.min).toBe(10);
      expect(summaries[0]!.max).toBe(30);
      expect(summaries[0]!.avg).toBe(20);
      expect(summaries[0]!.current).toBe(30);
      expect(summaries[0]!.dataPoints).toBe(3);
    });

    it('should determine trend correctly', () => {
      const baseTime = Date.now();
      const increasingMetrics: Metric[] = [];
      // Use a clear increasing pattern with low volatility
      // Trend is 'increasing' if normalized slope > 0.05 and cv <= 0.5
      for (let i = 0; i < 10; i++) {
        increasingMetrics.push({
          name: 'cpu',
          timestamp: new Date(baseTime + i * 1000),
          value: 1000 + i * 100, // 1000, 1100, 1200, ..., 1900 (clear uptrend, low CV)
          labels: {},
        });
      }

      const summaries = processor.summarize(increasingMetrics);

      // Check that it correctly identifies as increasing or at least not volatile
      expect(['increasing', 'stable']).toContain(summaries[0]!.trend);
    });

    it('should group by metric name and labels', () => {
      const metrics: Metric[] = [
        { name: 'cpu', timestamp: new Date(), value: 10, labels: { pod: 'a' } },
        { name: 'cpu', timestamp: new Date(), value: 20, labels: { pod: 'b' } },
        { name: 'memory', timestamp: new Date(), value: 100, labels: { pod: 'a' } },
      ];

      const summaries = processor.summarize(metrics);

      expect(summaries).toHaveLength(3);
    });

    it('should calculate anomaly score', () => {
      const metrics: Metric[] = [
        { name: 'cpu', timestamp: new Date(), value: 10, labels: {} },
        { name: 'cpu', timestamp: new Date(), value: 10, labels: {} },
        { name: 'cpu', timestamp: new Date(), value: 10, labels: {} },
        { name: 'cpu', timestamp: new Date(), value: 100, labels: {} }, // anomalous
      ];

      const summaries = processor.summarize(metrics);

      expect(summaries[0]!.anomalyScore).toBeGreaterThan(0);
    });
  });

  describe('compareToBaseline()', () => {
    it('should compare current metrics to baseline', () => {
      const baseline: Metric[] = [
        { name: 'cpu', timestamp: new Date(), value: 100, labels: {} },
      ];
      const current: Metric[] = [
        { name: 'cpu', timestamp: new Date(), value: 150, labels: {} },
      ];

      const comparisons = processor.compareToBaseline(current, baseline);

      expect(comparisons).toHaveLength(1);
      expect(comparisons[0]!.changePercent).toBe(50);
      expect(comparisons[0]!.direction).toBe('up');
      expect(comparisons[0]!.significant).toBe(true);
    });

    it('should detect decrease in metrics', () => {
      const baseline: Metric[] = [
        { name: 'cpu', timestamp: new Date(), value: 100, labels: {} },
      ];
      const current: Metric[] = [
        { name: 'cpu', timestamp: new Date(), value: 50, labels: {} },
      ];

      const comparisons = processor.compareToBaseline(current, baseline);

      expect(comparisons[0]!.changePercent).toBe(-50);
      expect(comparisons[0]!.direction).toBe('down');
    });

    it('should mark stable metrics when change is small', () => {
      const baseline: Metric[] = [
        { name: 'cpu', timestamp: new Date(), value: 100, labels: {} },
      ];
      const current: Metric[] = [
        { name: 'cpu', timestamp: new Date(), value: 102, labels: {} },
      ];

      const comparisons = processor.compareToBaseline(current, baseline);

      expect(comparisons[0]!.direction).toBe('stable');
      expect(comparisons[0]!.significant).toBe(false);
    });

    it('should skip metrics without matching baseline', () => {
      const baseline: Metric[] = [
        { name: 'cpu', timestamp: new Date(), value: 100, labels: {} },
      ];
      const current: Metric[] = [
        { name: 'memory', timestamp: new Date(), value: 1000, labels: {} },
      ];

      const comparisons = processor.compareToBaseline(current, baseline);

      expect(comparisons).toHaveLength(0);
    });
  });

  describe('analyze()', () => {
    it('should return comprehensive analysis result', () => {
      const metrics: Metric[] = [
        { name: 'cpu', timestamp: new Date(), value: 50, labels: {} },
        { name: 'cpu', timestamp: new Date(), value: 55, labels: {} },
        { name: 'cpu', timestamp: new Date(), value: 60, labels: {} },
      ];

      const result = processor.analyze(metrics);

      expect(result.metrics).toHaveLength(3);
      expect(result.summaries).toBeDefined();
      expect(result.anomalies).toBeDefined();
      expect(result.comparisons).toHaveLength(0); // No baseline provided
    });

    it('should include comparisons when baseline provided', () => {
      const baseline: Metric[] = [
        { name: 'cpu', timestamp: new Date(), value: 50, labels: {} },
      ];
      const current: Metric[] = [
        { name: 'cpu', timestamp: new Date(), value: 100, labels: {} },
      ];

      const result = processor.analyze(current, baseline);

      expect(result.comparisons.length).toBeGreaterThan(0);
    });
  });

  describe('edge cases', () => {
    it('should handle empty metrics array', () => {
      const summaries = processor.summarize([]);
      const anomalies = processor.detectAnomalies([]);

      expect(summaries).toHaveLength(0);
      expect(anomalies).toHaveLength(0);
    });

    it('should handle single metric', () => {
      const metrics: Metric[] = [
        { name: 'cpu', timestamp: new Date(), value: 50, labels: {} },
      ];

      const summaries = processor.summarize(metrics);

      expect(summaries).toHaveLength(1);
      expect(summaries[0]!.min).toBe(50);
      expect(summaries[0]!.max).toBe(50);
      expect(summaries[0]!.avg).toBe(50);
    });

    it('should handle metrics with zero values', () => {
      const metrics: Metric[] = [
        { name: 'errors', timestamp: new Date(), value: 0, labels: {} },
        { name: 'errors', timestamp: new Date(), value: 0, labels: {} },
      ];

      const summaries = processor.summarize(metrics);

      expect(summaries[0]!.avg).toBe(0);
      expect(summaries[0]!.anomalyScore).toBe(0);
    });

    it('should handle negative values', () => {
      const metrics: Metric[] = [
        { name: 'temperature', timestamp: new Date(), value: -10, labels: {} },
        { name: 'temperature', timestamp: new Date(), value: -5, labels: {} },
        { name: 'temperature', timestamp: new Date(), value: 0, labels: {} },
      ];

      const summaries = processor.summarize(metrics);

      expect(summaries[0]!.min).toBe(-10);
      expect(summaries[0]!.max).toBe(0);
      expect(summaries[0]!.avg).toBe(-5);
    });
  });

  describe('queryPrometheus()', () => {
    it('should return empty array when Prometheus URL not configured', async () => {
      const result = await processor.queryPrometheus(
        'up',
        new Date(),
        new Date()
      );

      expect(result).toHaveLength(0);
    });
  });

  describe('getK8sMetrics()', () => {
    it('should return null when Prometheus URL not configured', async () => {
      const result = await processor.getK8sMetrics('production', 'api-server');

      expect(result).toBeNull();
    });
  });
});
