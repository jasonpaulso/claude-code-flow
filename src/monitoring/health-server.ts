/**
 * HTTP server for health checks and status queries
 * Allows other terminals to check orchestrator status
 */

import { HealthCheckEndpoint } from './health-endpoint.ts';
import { Logger } from '../core/logger.ts';
import { configManager } from '../core/config.ts';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

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
  
  constructor(healthEndpoint: HealthCheckEndpoint, config?: Partial<HealthServerConfig>) {
    this.logger = new Logger(
      { level: 'info', format: 'json', destination: 'console' },
      { component: 'HealthServer' }
    );
    
    this.config = {
      port: config?.port || 3001,
      host: config?.host || 'localhost',
      pidFile: config?.pidFile || '.claude-flow.status.json'
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
      
      this.logger.info(`Health server started on ${this.config.host}:${this.config.port}`);
    } catch (error) {
      this.logger.error('Failed to start health server', error);
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
    
    switch (url.pathname) {
      case '/health':
        return await this.handleHealthCheck();
        
      case '/health/quick':
        return await this.handleQuickCheck();
        
      case '/metrics':
        return await this.handleMetrics();
        
      case '/status':
        return await this.handleFullStatus();
        
      default:
        return new Response('Not Found', { status: 404 });
    }
  }
  
  private async handleHealthCheck(): Promise<Response> {
    try {
      const health = await this.healthEndpoint.checkHealth();
      return new Response(JSON.stringify(health), {
        status: health.status === 'healthy' ? 200 : 503,
        headers: {
          'Content-Type': 'application/json'
        }
      });
    } catch (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: {
          'Content-Type': 'application/json'
        }
      });
    }
  }
  
  private async handleQuickCheck(): Promise<Response> {
    try {
      const health = await this.healthEndpoint.quickCheck();
      return new Response(JSON.stringify(health), {
        status: health.status === 'healthy' ? 200 : 503,
        headers: {
          'Content-Type': 'application/json'
        }
      });
    } catch (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: {
          'Content-Type': 'application/json'
        }
      });
    }
  }
  
  private async handleMetrics(): Promise<Response> {
    try {
      const health = await this.healthEndpoint.checkHealth();
      const metrics = this.formatPrometheusMetrics(health.metrics);
      
      return new Response(metrics, {
        status: 200,
        headers: {
          'Content-Type': 'text/plain; version=0.0.4'
        }
      });
    } catch (error) {
      return new Response(`# Error: ${error.message}`, {
        status: 500,
        headers: {
          'Content-Type': 'text/plain'
        }
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
          coordination: config.coordination.strategy
        },
        pid: Deno.pid,
        serverInfo: {
          host: this.config.host,
          port: this.config.port
        }
      };
      
      return new Response(JSON.stringify(fullStatus, null, 2), {
        status: 200,
        headers: {
          'Content-Type': 'application/json'
        }
      });
    } catch (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: {
          'Content-Type': 'application/json'
        }
      });
    }
  }
  
  private formatPrometheusMetrics(metrics: any): string {
    const lines = [
      '# HELP claude_flow_active_agents Number of active agents',
      '# TYPE claude_flow_active_agents gauge',
      `claude_flow_active_agents ${metrics.activeAgents}`,
      '',
      '# HELP claude_flow_total_tasks Total number of tasks',
      '# TYPE claude_flow_total_tasks gauge',
      `claude_flow_total_tasks ${metrics.totalTasks}`,
      '',
      '# HELP claude_flow_queued_tasks Number of queued tasks',
      '# TYPE claude_flow_queued_tasks gauge',
      `claude_flow_queued_tasks ${metrics.queuedTasks}`,
      '',
      '# HELP claude_flow_memory_usage_bytes Memory usage in bytes',
      '# TYPE claude_flow_memory_usage_bytes gauge',
      `claude_flow_memory_usage_bytes ${metrics.memoryUsage}`,
      '',
      '# HELP claude_flow_cpu_usage_percent CPU usage percentage',
      '# TYPE claude_flow_cpu_usage_percent gauge',
      `claude_flow_cpu_usage_percent ${metrics.cpuUsage}`,
      '',
      '# HELP claude_flow_error_rate Error rate',
      '# TYPE claude_flow_error_rate gauge',
      `claude_flow_error_rate ${metrics.errorRate}`,
      '',
      '# HELP claude_flow_average_response_time_ms Average response time in milliseconds',
      '# TYPE claude_flow_average_response_time_ms gauge',
      `claude_flow_average_response_time_ms ${metrics.averageResponseTime}`,
    ];
    
    return lines.join('\n');
  }
  
  private async writeStatusFile(): Promise<void> {
    const statusInfo = {
      pid: Deno.pid,
      port: this.config.port,
      host: this.config.host,
      startTime: new Date().toISOString(),
      version: '1.0.43',
      healthUrl: `http://${this.config.host}:${this.config.port}/health`,
      statusUrl: `http://${this.config.host}:${this.config.port}/status`
    };
    
    await fs.writeFile(
      this.config.pidFile,
      JSON.stringify(statusInfo, null, 2)
    );
  }
}