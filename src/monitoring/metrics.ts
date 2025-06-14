/**
 * Prometheus-compatible metrics collection and export
 */

import { EventEmitter } from "node:events";
import { Logger } from "../core/logger.ts";
import type { ILogger } from "../core/logger.ts";

export interface MetricValue {
  name: string;
  type: "counter" | "gauge" | "histogram" | "summary";
  value: number;
  labels?: Record<string, string>;
  timestamp?: number;
}

export interface MetricDefinition {
  name: string;
  type: "counter" | "gauge" | "histogram" | "summary";
  help: string;
  labels?: string[];
}

export class MetricsCollector extends EventEmitter {
  private logger: ILogger;
  private metrics: Map<string, MetricDefinition>;
  private values: Map<string, Map<string, MetricValue>>;
  private startTime: number;

  constructor() {
    super();
    this.logger = new Logger(
      { level: "info", format: "json", destination: "console" },
      { component: "MetricsCollector" },
    );
    this.metrics = new Map();
    this.values = new Map();
    this.startTime = Date.now();

    this.registerDefaultMetrics();
  }

  /**
   * Register default system metrics
   */
  private registerDefaultMetrics(): void {
    // Process metrics
    this.register({
      name: "claude_flow_process_uptime_seconds",
      type: "gauge",
      help: "Process uptime in seconds",
    });

    this.register({
      name: "claude_flow_process_memory_bytes",
      type: "gauge",
      help: "Process memory usage in bytes",
      labels: ["type"],
    });

    // Swarm metrics
    this.register({
      name: "claude_flow_agents_total",
      type: "gauge",
      help: "Total number of agents",
      labels: ["status", "type"],
    });

    this.register({
      name: "claude_flow_tasks_total",
      type: "counter",
      help: "Total number of tasks",
      labels: ["status"],
    });

    this.register({
      name: "claude_flow_task_duration_seconds",
      type: "histogram",
      help: "Task execution duration in seconds",
      labels: ["type", "status"],
    });

    // System metrics
    this.register({
      name: "claude_flow_errors_total",
      type: "counter",
      help: "Total number of errors",
      labels: ["component", "type"],
    });

    this.register({
      name: "claude_flow_http_requests_total",
      type: "counter",
      help: "Total number of HTTP requests",
      labels: ["method", "endpoint", "status"],
    });

    this.register({
      name: "claude_flow_http_request_duration_seconds",
      type: "histogram",
      help: "HTTP request duration in seconds",
      labels: ["method", "endpoint"],
    });

    // Memory system metrics
    this.register({
      name: "claude_flow_memory_entries_total",
      type: "gauge",
      help: "Total number of memory entries",
      labels: ["namespace"],
    });

    this.register({
      name: "claude_flow_memory_size_bytes",
      type: "gauge",
      help: "Memory system size in bytes",
      labels: ["namespace"],
    });
  }

  /**
   * Register a new metric
   */
  register(definition: MetricDefinition): void {
    if (this.metrics.has(definition.name)) {
      this.logger.warn(`Metric ${definition.name} already registered`);
      return;
    }

    this.metrics.set(definition.name, definition);
    this.values.set(definition.name, new Map());
    this.logger.debug(`Registered metric: ${definition.name}`);
  }

  /**
   * Increment a counter metric
   */
  inc(name: string, labels?: Record<string, string>, value: number = 1): void {
    const metric = this.metrics.get(name);
    if (!metric || metric.type !== "counter") {
      this.logger.warn(`Invalid counter metric: ${name}`);
      return;
    }

    const key = this.getLabelKey(labels);
    const values = this.values.get(name)!;
    const current = values.get(key);

    if (current) {
      current.value += value;
      current.timestamp = Date.now();
    } else {
      values.set(key, {
        name,
        type: "counter",
        value,
        labels,
        timestamp: Date.now(),
      });
    }
  }

  /**
   * Set a gauge metric
   */
  set(name: string, value: number, labels?: Record<string, string>): void {
    const metric = this.metrics.get(name);
    if (!metric || metric.type !== "gauge") {
      this.logger.warn(`Invalid gauge metric: ${name}`);
      return;
    }

    const key = this.getLabelKey(labels);
    const values = this.values.get(name)!;

    values.set(key, {
      name,
      type: "gauge",
      value,
      labels,
      timestamp: Date.now(),
    });
  }

  /**
   * Observe a histogram metric
   */
  observe(name: string, value: number, labels?: Record<string, string>): void {
    const metric = this.metrics.get(name);
    if (!metric || (metric.type !== "histogram" && metric.type !== "summary")) {
      this.logger.warn(`Invalid histogram/summary metric: ${name}`);
      return;
    }

    // For simplicity, we'll store histogram values as arrays
    const key = this.getLabelKey(labels);
    const values = this.values.get(name)!;
    const current = values.get(key);

    if (current && Array.isArray(current.value)) {
      (current.value as any).push(value);
      current.timestamp = Date.now();
    } else {
      values.set(key, {
        name,
        type: metric.type,
        value: [value] as any,
        labels,
        timestamp: Date.now(),
      });
    }
  }

  /**
   * Collect current process metrics
   */
  collectProcessMetrics(): void {
    // Uptime
    this.set(
      "claude_flow_process_uptime_seconds",
      (Date.now() - this.startTime) / 1000,
    );

    // Memory usage
    if (globalThis.Deno) {
      const memInfo = Deno.memoryUsage();
      this.set("claude_flow_process_memory_bytes", memInfo.rss, {
        type: "rss",
      });
      this.set("claude_flow_process_memory_bytes", memInfo.heapUsed, {
        type: "heap_used",
      });
      this.set("claude_flow_process_memory_bytes", memInfo.heapTotal, {
        type: "heap_total",
      });
      this.set("claude_flow_process_memory_bytes", memInfo.external, {
        type: "external",
      });
    }
  }

  /**
   * Export metrics in Prometheus format
   */
  export(): string {
    const lines: string[] = [];

    // Collect latest process metrics
    this.collectProcessMetrics();

    // Export each metric
    for (const [metricName, definition] of this.metrics) {
      // Add help text
      lines.push(`# HELP ${metricName} ${definition.help}`);
      lines.push(`# TYPE ${metricName} ${definition.type}`);

      // Export values
      const values = this.values.get(metricName)!;
      for (const [key, value] of values) {
        const labelStr = this.formatLabels(value.labels);

        if (definition.type === "histogram" || definition.type === "summary") {
          // For histograms, we need to calculate buckets and summary
          const observations = value.value as any as number[];
          if (observations && observations.length > 0) {
            // Simple implementation: just count and sum
            const count = observations.length;
            const sum = observations.reduce((a, b) => a + b, 0);

            lines.push(`${metricName}_count${labelStr} ${count}`);
            lines.push(`${metricName}_sum${labelStr} ${sum}`);

            // Add percentiles for summary
            if (definition.type === "summary") {
              const sorted = observations.sort((a, b) => a - b);
              const p50 = sorted[Math.floor(sorted.length * 0.5)];
              const p90 = sorted[Math.floor(sorted.length * 0.9)];
              const p99 = sorted[Math.floor(sorted.length * 0.99)];

              lines.push(
                `${metricName}{quantile="0.5"${labelStr ? "," + labelStr.slice(1) : ""} ${p50}`,
              );
              lines.push(
                `${metricName}{quantile="0.9"${labelStr ? "," + labelStr.slice(1) : ""} ${p90}`,
              );
              lines.push(
                `${metricName}{quantile="0.99"${labelStr ? "," + labelStr.slice(1) : ""} ${p99}`,
              );
            }
          }
        } else {
          // Counter or gauge
          lines.push(`${metricName}${labelStr} ${value.value}`);
        }
      }

      lines.push(""); // Empty line between metrics
    }

    return lines.join("\n");
  }

  /**
   * Get metrics as JSON
   */
  toJSON(): Record<string, any> {
    const result: Record<string, any> = {};

    for (const [metricName, definition] of this.metrics) {
      const values = this.values.get(metricName)!;
      const metricData: any[] = [];

      for (const [key, value] of values) {
        metricData.push({
          labels: value.labels || {},
          value: value.value,
          timestamp: value.timestamp,
        });
      }

      result[metricName] = {
        type: definition.type,
        help: definition.help,
        values: metricData,
      };
    }

    return result;
  }

  /**
   * Create label key for storage
   */
  private getLabelKey(labels?: Record<string, string>): string {
    if (!labels || Object.keys(labels).length === 0) {
      return "default";
    }

    return Object.entries(labels)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}:${v}`)
      .join(",");
  }

  /**
   * Format labels for Prometheus export
   */
  private formatLabels(labels?: Record<string, string>): string {
    if (!labels || Object.keys(labels).length === 0) {
      return "";
    }

    const pairs = Object.entries(labels)
      .map(([k, v]) => `${k}="${v}"`)
      .join(",");

    return `{${pairs}}`;
  }

  /**
   * Clear all metrics
   */
  clear(): void {
    for (const values of this.values.values()) {
      values.clear();
    }
  }

  /**
   * Get a specific metric value
   */
  get(name: string, labels?: Record<string, string>): MetricValue | undefined {
    const values = this.values.get(name);
    if (!values) {
      return undefined;
    }

    const key = this.getLabelKey(labels);
    return values.get(key);
  }
}
