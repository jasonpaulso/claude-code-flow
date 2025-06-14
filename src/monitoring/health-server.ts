/**
 * HTTP server for health checks and status queries
 * Allows other terminals to check orchestrator status
 */

import { HealthCheckEndpoint } from "./health-endpoint.ts";
import { Logger } from "../core/logger.ts";
import { configManager } from "../core/config.ts";
import * as fs from "node:fs/promises";
import * as path from "node:path";

export interface HealthServerConfig {
  port: number;
  host: string;
  pidFile: string;
}

export class HealthServer {
  private server?: Deno.HttpServer;
  private logger: Logger;
  private config: HealthServerConfig;
  private healthEndpoint: HealthCheckEndpoint;

  constructor(
    healthEndpoint: HealthCheckEndpoint,
    config?: Partial<HealthServerConfig>,
  ) {
    this.logger = new Logger(
      { level: "info", format: "json", destination: "console" },
      { component: "HealthServer" },
    );

    this.config = {
      port: config?.port || 3001,
      host: config?.host || "localhost",
      pidFile: config?.pidFile || ".claude-flow.status.json",
    };

    this.healthEndpoint = healthEndpoint;
  }

  async start(): Promise<void> {
    try {
      // Write status file with connection info
      await this.writeStatusFile();

      // Start HTTP server
      this.server = Deno.serve({
        port: this.config.port,
        hostname: this.config.host,
        handler: async (req) => this.handleRequest(req),
      });

      this.logger.info(
        `Health server started on ${this.config.host}:${this.config.port}`,
      );
    } catch (error) {
      this.logger.error("Failed to start health server", error);
      throw error;
    }
  }

  async stop(): Promise<void> {
    if (this.server) {
      await this.server.shutdown();
      this.server = undefined;
    }

    // Remove status file
    try {
      await Deno.remove(this.config.pidFile);
    } catch {
      // Ignore if already removed
    }
  }

  private async handleRequest(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const start = Date.now();
    let response: Response;

    try {
      switch (url.pathname) {
        case "/health":
          response = await this.handleHealthCheck();
          break;

        case "/health/quick":
          response = await this.handleQuickCheck();
          break;

        case "/metrics":
          response = await this.handleMetrics();
          break;

        case "/status":
          response = await this.handleFullStatus();
          break;

        case "/metrics/json":
          response = await this.handleMetricsJSON();
          break;

        default:
          response = new Response("Not Found", { status: 404 });
      }

      // Track HTTP metrics
      const duration = Date.now() - start;
      this.healthEndpoint.trackHttpRequest(
        req.method,
        url.pathname,
        response.status,
        duration,
      );

      return response;
    } catch (error) {
      this.logger.error("Error handling request:", error);
      response = new Response("Internal Server Error", { status: 500 });

      // Track error
      const duration = Date.now() - start;
      this.healthEndpoint.trackHttpRequest(
        req.method,
        url.pathname,
        500,
        duration,
      );

      return response;
    }
  }

  private async handleHealthCheck(): Promise<Response> {
    try {
      const health = await this.healthEndpoint.checkHealth();
      return new Response(JSON.stringify(health), {
        status: health.status === "healthy" ? 200 : 503,
        headers: {
          "Content-Type": "application/json",
        },
      });
    } catch (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: {
          "Content-Type": "application/json",
        },
      });
    }
  }

  private async handleQuickCheck(): Promise<Response> {
    try {
      const health = await this.healthEndpoint.quickCheck();
      return new Response(JSON.stringify(health), {
        status: health.status === "healthy" ? 200 : 503,
        headers: {
          "Content-Type": "application/json",
        },
      });
    } catch (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: {
          "Content-Type": "application/json",
        },
      });
    }
  }

  private async handleMetrics(): Promise<Response> {
    try {
      const metrics = this.healthEndpoint.exportPrometheusMetrics();

      return new Response(metrics, {
        status: 200,
        headers: {
          "Content-Type": "text/plain; version=0.0.4",
        },
      });
    } catch (error) {
      return new Response(`# Error: ${error.message}`, {
        status: 500,
        headers: {
          "Content-Type": "text/plain",
        },
      });
    }
  }

  private async handleMetricsJSON(): Promise<Response> {
    try {
      const metrics = this.healthEndpoint.getMetricsJSON();

      return new Response(JSON.stringify(metrics, null, 2), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
        },
      });
    } catch (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: {
          "Content-Type": "application/json",
        },
      });
    }
  }

  private async handleFullStatus(): Promise<Response> {
    try {
      const health = await this.healthEndpoint.checkHealth();
      const config = configManager.get();

      const fullStatus = {
        ...health,
        config: {
          swarm: config.swarm,
          memory: config.memory.backend,
          coordination: config.coordination.strategy,
        },
        pid: Deno.pid,
        serverInfo: {
          host: this.config.host,
          port: this.config.port,
        },
      };

      return new Response(JSON.stringify(fullStatus, null, 2), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
        },
      });
    } catch (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: {
          "Content-Type": "application/json",
        },
      });
    }
  }

  private async writeStatusFile(): Promise<void> {
    const statusInfo = {
      pid: Deno.pid,
      port: this.config.port,
      host: this.config.host,
      startTime: new Date().toISOString(),
      version: "1.0.43",
      healthUrl: `http://${this.config.host}:${this.config.port}/health`,
      statusUrl: `http://${this.config.host}:${this.config.port}/status`,
    };

    await fs.writeFile(
      this.config.pidFile,
      JSON.stringify(statusInfo, null, 2),
    );
  }
}
