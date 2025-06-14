/**
 * Agent spawning and process management for swarm coordination
 */

import { spawn, ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { Logger } from "../core/logger.ts";
import { generateId } from "../utils/helpers.ts";
import type { ILogger } from "../core/logger.ts";

export interface AgentSpawnOptions {
  name: string;
  type: "researcher" | "developer" | "analyzer" | "coordinator" | "reviewer";
  capabilities: string[];
  mcpConfig?: string;
  claudeArgs?: string[];
  environment?: Record<string, string>;
  workingDirectory?: string;
  timeout?: number;
}

export interface AgentProcess {
  id: string;
  name: string;
  type: AgentSpawnOptions["type"];
  process: ChildProcess;
  pid?: number;
  status: "starting" | "running" | "stopping" | "stopped" | "failed";
  startedAt: Date;
  stoppedAt?: Date;
  lastHeartbeat?: Date;
  capabilities: string[];
}

export interface AgentMessage {
  type:
    | "ready"
    | "heartbeat"
    | "task-update"
    | "task-complete"
    | "error"
    | "log";
  agentId: string;
  timestamp: Date;
  data?: any;
}

export class AgentSpawner extends EventEmitter {
  private logger: ILogger;
  private agents: Map<string, AgentProcess>;
  private heartbeatInterval: number = 30000; // 30 seconds
  private heartbeatTimers: Map<string, NodeJS.Timer>;
  private mockMode: boolean;

  constructor(mockMode: boolean = false) {
    super();
    this.logger = new Logger(
      { level: "info", format: "json", destination: "console" },
      { component: "AgentSpawner" },
    );
    this.agents = new Map();
    this.heartbeatTimers = new Map();
    this.mockMode = mockMode;
  }

  /**
   * Spawn a new agent process
   */
  async spawnAgent(options: AgentSpawnOptions): Promise<string> {
    const agentId = generateId("agent");

    this.logger.info(
      `Spawning agent: ${options.name} (${agentId}) - Mock: ${this.mockMode}`,
    );

    try {
      if (this.mockMode) {
        // Create mock agent process
        return this.spawnMockAgent(agentId, options);
      }

      // Prepare worker arguments
      const workerPath = new URL("./agent-worker.ts", import.meta.url).pathname;
      const args = ["--loader", "tsx", workerPath];

      // Spawn the agent worker process
      const agentProcess = spawn("node", args, {
        env: {
          ...process.env,
          CLAUDE_FLOW_AGENT_ID: agentId,
          CLAUDE_FLOW_AGENT_NAME: options.name,
          CLAUDE_FLOW_AGENT_TYPE: options.type,
          ...options.environment,
        },
        cwd: options.workingDirectory || process.cwd(),
        stdio: ["pipe", "pipe", "pipe", "ipc"], // Enable IPC channel
      });

      // Create agent record
      const agent: AgentProcess = {
        id: agentId,
        name: options.name,
        type: options.type,
        process: agentProcess,
        pid: agentProcess.pid,
        status: "starting",
        startedAt: new Date(),
        capabilities: options.capabilities,
      };

      this.agents.set(agentId, agent);

      // Set up IPC message handling
      this.setupAgentIPC(agentId, agentProcess);

      // Set up process event handlers
      this.setupProcessHandlers(agentId, agentProcess);

      // Start heartbeat monitoring
      this.startHeartbeatMonitoring(agentId);

      // Wait for agent to be ready
      await this.waitForAgentReady(agentId, options.timeout || 30000);

      this.logger.info(`Agent spawned successfully: ${agentId}`);
      this.emit("agent:spawned", { agentId, agent });

      return agentId;
    } catch (error) {
      this.logger.error(`Failed to spawn agent: ${error}`);
      throw error;
    }
  }

  /**
   * Set up IPC communication with agent
   */
  private setupAgentIPC(agentId: string, process: ChildProcess): void {
    if (!process.send) {
      this.logger.warn(`Agent ${agentId} does not support IPC`);
      return;
    }

    // Handle messages from agent
    process.on("message", (message: any) => {
      try {
        const agentMessage: AgentMessage = {
          type: message.type,
          agentId,
          timestamp: new Date(),
          data: message.data,
        };

        this.handleAgentMessage(agentMessage);
      } catch (error) {
        this.logger.error(`Invalid message from agent ${agentId}:`, error);
      }
    });
  }

  /**
   * Handle messages from agents
   */
  private handleAgentMessage(message: AgentMessage): void {
    const agent = this.agents.get(message.agentId);
    if (!agent) {
      this.logger.warn(
        `Received message from unknown agent: ${message.agentId}`,
      );
      return;
    }

    switch (message.type) {
      case "ready":
        agent.status = "running";
        this.emit("agent:ready", message);
        break;

      case "heartbeat":
        agent.lastHeartbeat = new Date();
        this.emit("agent:heartbeat", message);
        break;

      case "task-update":
        this.emit("agent:task-update", message);
        break;

      case "task-complete":
        this.emit("agent:task-complete", message);
        break;

      case "error":
        this.logger.error(`Agent ${message.agentId} error:`, message.data);
        this.emit("agent:error", message);
        break;

      case "log":
        this.logger.debug(`Agent ${message.agentId} log:`, message.data);
        this.emit("agent:log", message);
        break;

      default:
        this.logger.warn(
          `Unknown message type from agent ${message.agentId}: ${message.type}`,
        );
    }
  }

  /**
   * Set up process event handlers
   */
  private setupProcessHandlers(agentId: string, process: ChildProcess): void {
    process.on("exit", (code, signal) => {
      const agent = this.agents.get(agentId);
      if (agent) {
        agent.status = code === 0 ? "stopped" : "failed";
        agent.stoppedAt = new Date();
      }

      this.stopHeartbeatMonitoring(agentId);
      this.logger.info(
        `Agent ${agentId} exited with code ${code}, signal ${signal}`,
      );
      this.emit("agent:exit", { agentId, code, signal });
    });

    process.on("error", (error) => {
      this.logger.error(`Agent ${agentId} process error:`, error);
      this.emit("agent:error", { agentId, error });
    });

    // Capture stdout and stderr
    process.stdout?.on("data", (data) => {
      this.emit("agent:stdout", { agentId, data: data.toString() });
    });

    process.stderr?.on("data", (data) => {
      this.emit("agent:stderr", { agentId, data: data.toString() });
    });
  }

  /**
   * Start heartbeat monitoring for an agent
   */
  private startHeartbeatMonitoring(agentId: string): void {
    const timer = setInterval(() => {
      const agent = this.agents.get(agentId);
      if (!agent) {
        this.stopHeartbeatMonitoring(agentId);
        return;
      }

      const now = new Date();
      const lastHeartbeat = agent.lastHeartbeat || agent.startedAt;
      const timeSinceLastHeartbeat = now.getTime() - lastHeartbeat.getTime();

      if (timeSinceLastHeartbeat > this.heartbeatInterval * 2) {
        this.logger.warn(`Agent ${agentId} missed heartbeat`);
        this.emit("agent:heartbeat-missed", { agentId, lastHeartbeat });

        // Consider the agent as potentially failed
        if (agent.status === "running") {
          agent.status = "failed";
          this.emit("agent:failed", { agentId, reason: "heartbeat-timeout" });
        }
      }
    }, this.heartbeatInterval);

    this.heartbeatTimers.set(agentId, timer);
  }

  /**
   * Stop heartbeat monitoring for an agent
   */
  private stopHeartbeatMonitoring(agentId: string): void {
    const timer = this.heartbeatTimers.get(agentId);
    if (timer) {
      clearInterval(timer);
      this.heartbeatTimers.delete(agentId);
    }
  }

  /**
   * Wait for agent to be ready
   */
  private async waitForAgentReady(
    agentId: string,
    timeout: number,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.removeListener("agent:ready", readyHandler);
        reject(
          new Error(`Agent ${agentId} failed to start within ${timeout}ms`),
        );
      }, timeout);

      const readyHandler = (message: AgentMessage) => {
        if (message.agentId === agentId) {
          clearTimeout(timer);
          this.removeListener("agent:ready", readyHandler);
          resolve();
        }
      };

      this.on("agent:ready", readyHandler);
    });
  }

  /**
   * Send a message to an agent
   */
  async sendMessage(agentId: string, message: any): Promise<void> {
    const agent = this.agents.get(agentId);
    if (!agent) {
      throw new Error(`Agent ${agentId} not found`);
    }

    if (agent.status !== "running") {
      throw new Error(`Agent ${agentId} is not running`);
    }

    if (!agent.process.send) {
      throw new Error(`Agent ${agentId} does not support IPC`);
    }

    return new Promise((resolve, reject) => {
      agent.process.send(message, (error) => {
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      });
    });
  }

  /**
   * Terminate an agent
   */
  async terminateAgent(
    agentId: string,
    graceful: boolean = true,
  ): Promise<void> {
    const agent = this.agents.get(agentId);
    if (!agent) {
      throw new Error(`Agent ${agentId} not found`);
    }

    this.logger.info(`Terminating agent ${agentId} (graceful: ${graceful})`);

    try {
      if (graceful && agent.process.send) {
        // Send shutdown message
        await this.sendMessage(agentId, { type: "shutdown" });

        // Wait for graceful shutdown
        await new Promise<void>((resolve) => {
          const timeout = setTimeout(() => {
            // Force kill if graceful shutdown fails
            agent.process.kill("SIGKILL");
            resolve();
          }, 5000);

          agent.process.once("exit", () => {
            clearTimeout(timeout);
            resolve();
          });
        });
      } else {
        // Force kill
        agent.process.kill(graceful ? "SIGTERM" : "SIGKILL");
      }

      this.stopHeartbeatMonitoring(agentId);
      this.agents.delete(agentId);
      this.emit("agent:terminated", { agentId });
    } catch (error) {
      this.logger.error(`Failed to terminate agent ${agentId}:`, error);
      throw error;
    }
  }

  /**
   * Terminate all agents
   */
  async terminateAll(graceful: boolean = true): Promise<void> {
    const promises = Array.from(this.agents.keys()).map((agentId) =>
      this.terminateAgent(agentId, graceful).catch((error) => {
        this.logger.error(`Error terminating agent ${agentId}:`, error);
      }),
    );

    await Promise.all(promises);
  }

  /**
   * Get agent by ID
   */
  getAgent(agentId: string): AgentProcess | undefined {
    return this.agents.get(agentId);
  }

  /**
   * Get all agents
   */
  getAllAgents(): AgentProcess[] {
    return Array.from(this.agents.values());
  }

  /**
   * Get agents by type
   */
  getAgentsByType(type: AgentSpawnOptions["type"]): AgentProcess[] {
    return Array.from(this.agents.values()).filter(
      (agent) => agent.type === type,
    );
  }

  /**
   * Get agents by status
   */
  getAgentsByStatus(status: AgentProcess["status"]): AgentProcess[] {
    return Array.from(this.agents.values()).filter(
      (agent) => agent.status === status,
    );
  }

  /**
   * Spawn a mock agent for testing
   */
  private async spawnMockAgent(
    agentId: string,
    options: AgentSpawnOptions,
  ): Promise<string> {
    // Create a mock process that simulates agent behavior
    const mockProcess = new MockAgentProcess(agentId, options);

    // Create agent record
    const agent: AgentProcess = {
      id: agentId,
      name: options.name,
      type: options.type,
      process: mockProcess as any,
      pid: process.pid, // Use current process PID for mock
      status: "starting",
      startedAt: new Date(),
      capabilities: options.capabilities,
    };

    this.agents.set(agentId, agent);

    // Set up mock IPC handling
    mockProcess.on("message", (message: any) => {
      this.handleAgentMessage({
        type: message.type,
        agentId,
        timestamp: new Date(),
        data: message.data,
      });
    });

    // Start heartbeat monitoring
    this.startHeartbeatMonitoring(agentId);

    return agentId;
  }
}

/**
 * Mock agent process for testing
 */
class MockAgentProcess extends EventEmitter {
  private agentId: string;
  private options: AgentSpawnOptions;
  public pid?: number;
  public killed: boolean = false;

  constructor(agentId: string, options: AgentSpawnOptions) {
    super();
    this.agentId = agentId;
    this.options = options;
    this.pid = process.pid;

    // Simulate agent ready after short delay
    setTimeout(() => {
      this.emit("message", {
        type: "ready",
        agentId: this.agentId,
        data: { initialized: true },
      });
    }, 100);
  }

  send(message: any, callback?: (error: Error | null) => void): boolean {
    // Simulate processing delay
    setTimeout(() => {
      try {
        this.handleMockMessage(message);
        if (callback) callback(null);
      } catch (error) {
        if (callback) callback(error as Error);
      }
    }, 100);
    return true;
  }

  private handleMockMessage(message: any): void {
    switch (message.type) {
      case "execute":
        // Simulate task execution
        setTimeout(() => {
          // Send progress update
          this.emit("message", {
            type: "task-update",
            agentId: this.agentId,
            data: {
              taskId: message.taskId,
              status: "running",
              progress: 50,
            },
          });

          // Simulate completion after delay
          setTimeout(() => {
            this.emit("message", {
              type: "task-complete",
              agentId: this.agentId,
              data: {
                taskId: message.taskId,
                result: {
                  success: true,
                  output: `Mock execution completed for task: ${message.prompt}`,
                  targetDir: message.targetDir,
                  files: message.targetDir
                    ? [`${message.targetDir}/mock-output.txt`]
                    : [],
                },
              },
            });
          }, 2000); // Increased delay for more realistic execution
        }, 500);
        break;

      case "heartbeat":
        this.emit("message", {
          type: "heartbeat",
          agentId: this.agentId,
          data: { alive: true },
        });
        break;

      case "shutdown":
        this.killed = true;
        this.emit("exit", 0, null);
        break;
    }
  }

  kill(signal?: string): void {
    this.killed = true;
    this.emit("exit", signal === "SIGKILL" ? 1 : 0, signal);
  }

  get stdout() {
    return { on: () => {} };
  }

  get stderr() {
    return { on: () => {} };
  }
}
