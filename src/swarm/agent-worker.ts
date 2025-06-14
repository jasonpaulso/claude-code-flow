/**
 * Agent Worker Process - Handles task execution for spawned agents
 */

import { spawn } from "node:child_process";
import { generateId } from "../utils/helpers.ts";

interface AgentMessage {
  type: "execute" | "status" | "heartbeat" | "shutdown";
  taskId?: string;
  prompt?: string;
  targetDir?: string;
  data?: any;
}

interface WorkerMessage {
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

class AgentWorker {
  private agentId: string;
  private heartbeatInterval?: NodeJS.Timer;
  private isRunning: boolean = true;

  constructor() {
    this.agentId = process.env.CLAUDE_FLOW_AGENT_ID || generateId("agent");
    this.setupMessageHandlers();
    this.startHeartbeat();
    this.sendReady();
  }

  private setupMessageHandlers(): void {
    process.on("message", async (message: AgentMessage) => {
      try {
        await this.handleMessage(message);
      } catch (error) {
        this.sendError(`Failed to handle message: ${error}`);
      }
    });

    process.on("SIGTERM", () => {
      this.shutdown("SIGTERM received");
    });

    process.on("SIGINT", () => {
      this.shutdown("SIGINT received");
    });
  }

  private async handleMessage(message: AgentMessage): Promise<void> {
    switch (message.type) {
      case "execute":
        await this.executeTask(message);
        break;
      case "status":
        this.sendStatus();
        break;
      case "heartbeat":
        this.sendHeartbeat();
        break;
      case "shutdown":
        this.shutdown("Shutdown requested");
        break;
      default:
        this.sendError(`Unknown message type: ${message.type}`);
    }
  }

  private async executeTask(message: AgentMessage): Promise<void> {
    if (!message.taskId || !message.prompt) {
      this.sendError("Missing taskId or prompt in execute message");
      return;
    }

    this.sendLog(`Starting task execution: ${message.taskId}`);
    this.sendTaskUpdate(message.taskId, { status: "starting" });

    try {
      // Build Claude command arguments
      const claudeArgs = [
        message.prompt,
        "--dangerously-skip-permissions",
        "-p", // Print mode
        "--output-format",
        "stream-json",
        "--verbose",
      ];

      // Execute Claude CLI
      const claudeProcess = spawn("claude", claudeArgs, {
        cwd: message.targetDir || process.cwd(),
        env: {
          ...process.env,
          CLAUDE_TASK_ID: message.taskId,
          CLAUDE_AGENT_WORKER: "true",
        },
      });

      let output = "";
      let errorOutput = "";

      claudeProcess.stdout.on("data", (data) => {
        output += data.toString();
        // Send progress updates
        this.sendTaskUpdate(message.taskId, {
          status: "running",
          progress: output.length,
        });
      });

      claudeProcess.stderr.on("data", (data) => {
        errorOutput += data.toString();
      });

      claudeProcess.on("close", (code) => {
        if (code === 0) {
          this.sendTaskComplete(message.taskId, {
            success: true,
            output: output,
            targetDir: message.targetDir,
          });
        } else {
          this.sendError(
            `Claude process exited with code ${code}: ${errorOutput}`,
          );
          this.sendTaskComplete(message.taskId, {
            success: false,
            error: errorOutput,
            code: code,
          });
        }
      });

      claudeProcess.on("error", (error) => {
        this.sendError(`Failed to spawn Claude process: ${error.message}`);
        this.sendTaskComplete(message.taskId, {
          success: false,
          error: error.message,
        });
      });
    } catch (error) {
      this.sendError(`Task execution failed: ${error}`);
      this.sendTaskComplete(message.taskId, {
        success: false,
        error: error.message,
      });
    }
  }

  private startHeartbeat(): void {
    this.heartbeatInterval = setInterval(() => {
      if (this.isRunning) {
        this.sendHeartbeat();
      }
    }, 30000); // 30 seconds
  }

  private stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = undefined;
    }
  }

  private sendMessage(message: WorkerMessage): void {
    if (process.send) {
      process.send(message);
    }
  }

  private sendReady(): void {
    this.sendMessage({
      type: "ready",
      agentId: this.agentId,
      timestamp: new Date(),
    });
  }

  private sendHeartbeat(): void {
    this.sendMessage({
      type: "heartbeat",
      agentId: this.agentId,
      timestamp: new Date(),
      data: {
        memory: process.memoryUsage(),
        uptime: process.uptime(),
      },
    });
  }

  private sendStatus(): void {
    this.sendMessage({
      type: "log",
      agentId: this.agentId,
      timestamp: new Date(),
      data: {
        status: "running",
        pid: process.pid,
        memory: process.memoryUsage(),
        uptime: process.uptime(),
      },
    });
  }

  private sendTaskUpdate(taskId: string, update: any): void {
    this.sendMessage({
      type: "task-update",
      agentId: this.agentId,
      timestamp: new Date(),
      data: {
        taskId,
        ...update,
      },
    });
  }

  private sendTaskComplete(taskId: string, result: any): void {
    this.sendMessage({
      type: "task-complete",
      agentId: this.agentId,
      timestamp: new Date(),
      data: {
        taskId,
        result,
      },
    });
  }

  private sendError(error: string): void {
    this.sendMessage({
      type: "error",
      agentId: this.agentId,
      timestamp: new Date(),
      data: error,
    });
  }

  private sendLog(message: string): void {
    this.sendMessage({
      type: "log",
      agentId: this.agentId,
      timestamp: new Date(),
      data: message,
    });
  }

  private shutdown(reason: string): void {
    if (!this.isRunning) {
      return;
    }

    this.isRunning = false;
    this.sendLog(`Shutting down: ${reason}`);
    this.stopHeartbeat();

    // Give some time for the last message to be sent
    setTimeout(() => {
      process.exit(0);
    }, 100);
  }
}

// Start the worker if this is the main module
if (import.meta.url === `file://${process.argv[1]}`) {
  new AgentWorker();
}

export { AgentWorker, AgentMessage, WorkerMessage };
