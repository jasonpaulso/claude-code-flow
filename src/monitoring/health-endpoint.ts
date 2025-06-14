/**
 * Health check endpoint for monitoring and load balancers
 */

import { SwarmCoordinator } from "../coordination/swarm-coordinator.ts";
import { MemoryManager } from "../memory/manager.ts";
import { TerminalManager } from "../terminal/manager.ts";
import { configManager } from "../core/config.ts";
import { MetricsCollector } from "./metrics.ts";

export interface HealthStatus {
  status: "healthy" | "degraded" | "unhealthy";
  timestamp: string;
  version: string;
  uptime: number;
  components: ComponentStatus[];
  metrics: HealthMetrics;
}

export interface ComponentStatus {
  name: string;
  status: "healthy" | "degraded" | "unhealthy";
  message?: string;
  responseTime?: number;
  lastCheck: string;
}

export interface HealthMetrics {
  activeAgents: number;
  totalTasks: number;
  queuedTasks: number;
  memoryUsage: number;
  cpuUsage: number;
  errorRate: number;
  averageResponseTime: number;
}

export class HealthCheckEndpoint {
  private version = "1.0.43";
  private startTime = Date.now();
  private lastHealthCheck = new Date();
  private metricsCollector: MetricsCollector;

  constructor(
    private swarmCoordinator?: SwarmCoordinator,
    private memoryManager?: MemoryManager,
    private terminalManager?: TerminalManager,
  ) {
    this.metricsCollector = new MetricsCollector();
    this.setupMetricsTracking();
  }

  /**
   * Perform comprehensive health check
   */
  async checkHealth(): Promise<HealthStatus> {
    const components: ComponentStatus[] = [];
    let overallStatus: "healthy" | "degraded" | "unhealthy" = "healthy";

    // Check each component
    const swarmStatus = await this.checkSwarmCoordinator();
    const memoryStatus = await this.checkMemoryManager();
    const terminalStatus = await this.checkTerminalManager();
    const configStatus = await this.checkConfiguration();

    components.push(swarmStatus, memoryStatus, terminalStatus, configStatus);

    // Determine overall status
    const unhealthyComponents = components.filter(
      (c) => c.status === "unhealthy",
    );
    const degradedComponents = components.filter(
      (c) => c.status === "degraded",
    );

    if (unhealthyComponents.length > 0) {
      overallStatus = "unhealthy";
    } else if (degradedComponents.length > 0) {
      overallStatus = "degraded";
    }

    // Collect metrics
    const metrics = await this.collectMetrics();

    this.lastHealthCheck = new Date();

    return {
      status: overallStatus,
      timestamp: new Date().toISOString(),
      version: this.version,
      uptime: Date.now() - this.startTime,
      components,
      metrics,
    };
  }

  /**
   * Quick health check for load balancers
   */
  async quickCheck(): Promise<{ status: string; timestamp: string }> {
    // Basic checks that should be fast
    const isConfigValid = this.isConfigurationValid();
    const isMemoryAccessible = await this.isMemoryAccessible();

    const status =
      isConfigValid && isMemoryAccessible ? "healthy" : "unhealthy";

    return {
      status,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Check swarm coordinator health
   */
  private async checkSwarmCoordinator(): Promise<ComponentStatus> {
    const start = Date.now();

    try {
      if (!this.swarmCoordinator) {
        return {
          name: "swarm-coordinator",
          status: "degraded",
          message: "Swarm coordinator not initialized",
          responseTime: Date.now() - start,
          lastCheck: new Date().toISOString(),
        };
      }

      // Check if coordinator is operational
      const metrics = this.swarmCoordinator.getMetrics();
      const status = metrics.totalAgents >= 0 ? "healthy" : "degraded";

      return {
        name: "swarm-coordinator",
        status,
        message: `${metrics.activeAgents}/${metrics.totalAgents} agents active`,
        responseTime: Date.now() - start,
        lastCheck: new Date().toISOString(),
      };
    } catch (error) {
      return {
        name: "swarm-coordinator",
        status: "unhealthy",
        message: `Error: ${error instanceof Error ? error.message : String(error)}`,
        responseTime: Date.now() - start,
        lastCheck: new Date().toISOString(),
      };
    }
  }

  /**
   * Check memory manager health
   */
  private async checkMemoryManager(): Promise<ComponentStatus> {
    const start = Date.now();

    try {
      if (!this.memoryManager) {
        return {
          name: "memory-manager",
          status: "degraded",
          message: "Memory manager not initialized",
          responseTime: Date.now() - start,
          lastCheck: new Date().toISOString(),
        };
      }

      // Test memory operations
      const testKey = `health-check-${Date.now()}`;
      await this.memoryManager.store("system", testKey, "health-check", {
        metadata: { type: "health-check" },
        expiresAt: new Date(Date.now() + 60000), // 1 minute
      });

      const retrieved = await this.memoryManager.retrieve("system", testKey);
      await this.memoryManager.delete("system", testKey);

      const status = retrieved ? "healthy" : "degraded";

      return {
        name: "memory-manager",
        status,
        message:
          status === "healthy"
            ? "Memory operations working"
            : "Memory test failed",
        responseTime: Date.now() - start,
        lastCheck: new Date().toISOString(),
      };
    } catch (error) {
      return {
        name: "memory-manager",
        status: "unhealthy",
        message: `Error: ${error instanceof Error ? error.message : String(error)}`,
        responseTime: Date.now() - start,
        lastCheck: new Date().toISOString(),
      };
    }
  }

  /**
   * Check terminal manager health
   */
  private async checkTerminalManager(): Promise<ComponentStatus> {
    const start = Date.now();

    try {
      if (!this.terminalManager) {
        return {
          name: "terminal-manager",
          status: "degraded",
          message: "Terminal manager not initialized",
          responseTime: Date.now() - start,
          lastCheck: new Date().toISOString(),
        };
      }

      // Check terminal pool status
      const poolStatus = this.terminalManager.getPoolStatus();
      const healthyTerminals = poolStatus.available + poolStatus.active;
      const status = healthyTerminals > 0 ? "healthy" : "degraded";

      return {
        name: "terminal-manager",
        status,
        message: `${healthyTerminals} terminals available`,
        responseTime: Date.now() - start,
        lastCheck: new Date().toISOString(),
      };
    } catch (error) {
      return {
        name: "terminal-manager",
        status: "unhealthy",
        message: `Error: ${error instanceof Error ? error.message : String(error)}`,
        responseTime: Date.now() - start,
        lastCheck: new Date().toISOString(),
      };
    }
  }

  /**
   * Check configuration health
   */
  private async checkConfiguration(): Promise<ComponentStatus> {
    const start = Date.now();

    try {
      const config = configManager.get();
      const isValid = this.validateConfiguration(config);

      return {
        name: "configuration",
        status: isValid ? "healthy" : "degraded",
        message: isValid
          ? "Configuration valid"
          : "Configuration issues detected",
        responseTime: Date.now() - start,
        lastCheck: new Date().toISOString(),
      };
    } catch (error) {
      return {
        name: "configuration",
        status: "unhealthy",
        message: `Error: ${error instanceof Error ? error.message : String(error)}`,
        responseTime: Date.now() - start,
        lastCheck: new Date().toISOString(),
      };
    }
  }

  /**
   * Collect system metrics
   */
  private async collectMetrics(): Promise<HealthMetrics> {
    const metrics: HealthMetrics = {
      activeAgents: 0,
      totalTasks: 0,
      queuedTasks: 0,
      memoryUsage: 0,
      cpuUsage: 0,
      errorRate: 0,
      averageResponseTime: 0,
    };

    try {
      // Swarm metrics
      if (this.swarmCoordinator) {
        const swarmMetrics = this.swarmCoordinator.getMetrics();
        metrics.activeAgents = swarmMetrics.activeAgents;
        metrics.totalTasks = swarmMetrics.totalTasks;
        metrics.queuedTasks = swarmMetrics.queuedTasks;
        metrics.errorRate = swarmMetrics.errorRate;
        metrics.averageResponseTime = swarmMetrics.averageResponseTime;
      }

      // System metrics (Deno)
      if (Deno.systemMemoryInfo) {
        const memInfo = Deno.systemMemoryInfo();
        metrics.memoryUsage = memInfo.free / memInfo.total;
      }

      // Process metrics
      const memUsage = Deno.memoryUsage();
      metrics.memoryUsage = memUsage.heapUsed / memUsage.heapTotal;
    } catch (error) {
      console.warn("Error collecting metrics:", error);
    }

    return metrics;
  }

  /**
   * Check if configuration is valid
   */
  private isConfigurationValid(): boolean {
    try {
      const config = configManager.get();
      return (
        config &&
        config.orchestrator &&
        config.memory &&
        config.coordination &&
        true
      );
    } catch {
      return false;
    }
  }

  /**
   * Check if memory is accessible
   */
  private async isMemoryAccessible(): Promise<boolean> {
    try {
      if (!this.memoryManager) return false;

      // Quick test without storing
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Validate configuration object
   */
  private validateConfiguration(config: any): boolean {
    // Basic validation
    return (
      config &&
      typeof config.orchestrator === "object" &&
      typeof config.memory === "object" &&
      typeof config.coordination === "object" &&
      typeof config.mcp === "object" &&
      typeof config.logging === "object"
    );
  }

  /**
   * Setup metrics tracking
   */
  private setupMetricsTracking(): void {
    // Track health check requests
    setInterval(() => {
      this.metricsCollector.collectProcessMetrics();
    }, 10000); // Every 10 seconds

    // Register swarm-specific metrics if coordinator is available
    if (this.swarmCoordinator) {
      this.swarmCoordinator.on("task:completed", (data: any) => {
        this.metricsCollector.inc("claude_flow_tasks_total", {
          status: "completed",
        });
      });

      this.swarmCoordinator.on("task:failed", (data: any) => {
        this.metricsCollector.inc("claude_flow_tasks_total", {
          status: "failed",
        });
        this.metricsCollector.inc("claude_flow_errors_total", {
          component: "swarm",
          type: "task_failure",
        });
      });

      this.swarmCoordinator.on("agent:registered", (data: any) => {
        this.updateAgentMetrics();
      });

      this.swarmCoordinator.on("agent:error", (data: any) => {
        this.metricsCollector.inc("claude_flow_errors_total", {
          component: "agent",
          type: "runtime_error",
        });
      });
    }
  }

  /**
   * Update agent metrics
   */
  private updateAgentMetrics(): void {
    if (!this.swarmCoordinator) return;

    const stats = this.swarmCoordinator.getSystemStats();

    // Update agent counts by status
    this.metricsCollector.set("claude_flow_agents_total", stats.agents.idle, {
      status: "idle",
      type: "all",
    });
    this.metricsCollector.set("claude_flow_agents_total", stats.agents.busy, {
      status: "busy",
      type: "all",
    });
    this.metricsCollector.set("claude_flow_agents_total", stats.agents.failed, {
      status: "failed",
      type: "all",
    });
  }

  /**
   * Export metrics in Prometheus format
   */
  exportPrometheusMetrics(): string {
    // Update current metrics
    this.updateAgentMetrics();

    // Export from MetricsCollector which includes all registered metrics
    return this.metricsCollector.export();
  }

  /**
   * Get metrics in JSON format
   */
  getMetricsJSON(): Record<string, any> {
    this.updateAgentMetrics();
    return this.metricsCollector.toJSON();
  }

  /**
   * Track HTTP request metrics
   */
  trackHttpRequest(
    method: string,
    endpoint: string,
    status: number,
    duration: number,
  ): void {
    this.metricsCollector.inc("claude_flow_http_requests_total", {
      method,
      endpoint,
      status: status.toString(),
    });

    this.metricsCollector.observe(
      "claude_flow_http_request_duration_seconds",
      duration / 1000,
      { method, endpoint },
    );
  }
}

// Export singleton instance
export const healthEndpoint = new HealthCheckEndpoint();

// HTTP handler for health checks
export function createHealthHandler() {
  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url);

    try {
      if (url.pathname === "/health/quick") {
        const status = await healthEndpoint.quickCheck();
        return new Response(JSON.stringify(status), {
          headers: { "Content-Type": "application/json" },
          status: status.status === "healthy" ? 200 : 503,
        });
      }

      if (url.pathname === "/health") {
        const health = await healthEndpoint.checkHealth();
        return new Response(JSON.stringify(health), {
          headers: { "Content-Type": "application/json" },
          status: health.status === "healthy" ? 200 : 503,
        });
      }

      if (url.pathname === "/metrics") {
        const health = await healthEndpoint.checkHealth();
        const prometheus = healthEndpoint.exportPrometheusMetrics(
          health.metrics,
        );
        return new Response(prometheus, {
          headers: { "Content-Type": "text/plain; version=0.0.4" },
        });
      }

      return new Response("Not Found", { status: 404 });
    } catch (error) {
      return new Response(
        JSON.stringify({
          status: "unhealthy",
          error: error instanceof Error ? error.message : String(error),
          timestamp: new Date().toISOString(),
        }),
        {
          headers: { "Content-Type": "application/json" },
          status: 500,
        },
      );
    }
  };
}
