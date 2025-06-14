import { EventEmitter } from "node:events";
import { spawn } from "node:child_process";
import { Logger } from "../core/logger.ts";
import { generateId } from "../utils/helpers.ts";
import { SwarmMonitor } from "./swarm-monitor.ts";
import { AdvancedTaskScheduler } from "./advanced-scheduler.ts";
import { MemoryManager } from "../memory/manager.ts";
import { EventBus } from "../core/event-bus.ts";
import type { IEventBus } from "../core/event-bus.ts";
import type { ILogger } from "../core/logger.ts";
import {
  SwarmError,
  TaskExecutionError,
  CoordinationError,
  ErrorRecovery,
} from "../utils/error-types.ts";
import { Message } from "../utils/types.ts";
import process from "node:process";
import { WorkStealingCoordinator } from "./work-stealing.ts";
import { CircuitBreaker } from "./circuit-breaker.ts";
import { AgentSpawner } from "../swarm/agent-spawner.ts";
import type { AgentProcess, AgentMessage } from "../swarm/agent-spawner.ts";

export interface SwarmAgent {
  id: string;
  name: string;
  type: "researcher" | "developer" | "analyzer" | "coordinator" | "reviewer";
  status: "idle" | "busy" | "failed" | "completed";
  capabilities: string[];
  currentTask?: SwarmTask;
  processId?: number;
  process?: any; // Node.js ChildProcess
  terminalId?: string;
  instanceId?: string;
  metrics: {
    tasksCompleted: number;
    tasksFailed: number;
    totalDuration: number;
    lastActivity: Date;
  };
}

export interface SwarmTask {
  id: string;
  type: string;
  description: string;
  priority: number;
  dependencies: string[];
  assignedTo?: string;
  status: "pending" | "running" | "completed" | "failed";
  result?: any;
  error?: string;
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  retryCount: number;
  maxRetries: number;
  timeout?: number;
  tools?: string[];
  skipPermissions?: boolean;
  mcpConfig?: string;
  claudeArgs?: string[];
}

export interface SwarmObjective {
  id: string;
  description: string;
  strategy: "auto" | "research" | "development" | "analysis";
  tasks: SwarmTask[];
  status: "planning" | "executing" | "completed" | "failed";
  createdAt: Date;
  completedAt?: Date;
}

export interface SwarmConfig {
  maxAgents: number;
  maxConcurrentTasks: number;
  taskTimeout: number;
  enableMonitoring: boolean;
  enableWorkStealing: boolean;
  enableCircuitBreaker: boolean;
  memoryNamespace: string;
  coordinationStrategy: "centralized" | "distributed" | "hybrid";
  backgroundTaskInterval: number;
  healthCheckInterval: number;
  maxRetries: number;
  backoffMultiplier: number;
}

export class SwarmCoordinator extends EventEmitter {
  private logger: ILogger;
  private config: SwarmConfig;
  private agents: Map<string, SwarmAgent>;
  private objectives: Map<string, SwarmObjective>;
  private tasks: Map<string, SwarmTask>;
  private monitor?: SwarmMonitor;
  private scheduler?: AdvancedTaskScheduler;
  private memoryManager: MemoryManager;
  private backgroundWorkers: Map<string, number>;
  private isRunning: boolean = false;
  private eventBus: IEventBus;
  private workStealer?: WorkStealingCoordinator;
  private circuitBreaker?: CircuitBreaker;
  private agentSpawner: AgentSpawner;

  constructor(config: Partial<SwarmConfig> = {}) {
    super();
    this.logger = new Logger(
      { level: "info", format: "json", destination: "console" },
      { component: "SwarmCoordinator" },
    );
    this.eventBus = EventBus.getInstance();
    this.config = {
      maxAgents: 10,
      maxConcurrentTasks: 5,
      taskTimeout: 300000, // 5 minutes
      enableMonitoring: true,
      enableWorkStealing: true,
      enableCircuitBreaker: true,
      memoryNamespace: "swarm",
      coordinationStrategy: "hybrid",
      backgroundTaskInterval: 5000, // 5 seconds
      healthCheckInterval: 10000, // 10 seconds
      maxRetries: 3,
      backoffMultiplier: 2,
      ...config,
    };

    this.agents = new Map();
    this.objectives = new Map();
    this.tasks = new Map();
    this.backgroundWorkers = new Map();

    // Initialize agent spawner
    this.agentSpawner = new AgentSpawner();
    this.setupAgentSpawnerHandlers();

    // Initialize memory manager
    this.memoryManager = new MemoryManager(
      {
        backend: "markdown",
        cacheSizeMB: 100,
        syncInterval: 30000,
        conflictResolution: "last-write",
        retentionDays: 30,
        markdownDir: `./swarm-runs/memory/${this.config.memoryNamespace}`,
      },
      this.eventBus,
      this.logger,
    );

    if (this.config.enableMonitoring) {
      this.monitor = new SwarmMonitor({
        updateInterval: 1000,
        enableAlerts: true,
        enableHistory: true,
      });
    }

    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    // Monitor events
    if (this.monitor) {
      this.monitor.on("alert", (alert: any) => {
        this.handleMonitorAlert(alert);
      });
    }

    // Add custom event handlers for swarm coordination
    this.on("task:completed", (data: any) => {
      this.handleTaskCompleted(data.taskId, data.result);
    });

    this.on("task:failed", (data: any) => {
      this.handleTaskFailed(data.taskId, data.error);
    });
  }

  private setupAgentSpawnerHandlers(): void {
    // Handle agent events
    this.agentSpawner.on("agent:ready", (message: AgentMessage) => {
      this.logger.info(`Agent ${message.agentId} is ready`);
      const agent = this.agents.get(message.agentId);
      if (agent) {
        agent.status = "idle";
      }
    });

    this.agentSpawner.on("agent:task-complete", (message: AgentMessage) => {
      this.handleAgentTaskComplete(message.agentId, message.data);
    });

    this.agentSpawner.on("agent:error", (message: AgentMessage) => {
      this.logger.error(`Agent ${message.agentId} error:`, message.data);
      this.handleAgentError(message.agentId, message.data);
    });

    this.agentSpawner.on(
      "agent:failed",
      (data: { agentId: string; reason: string }) => {
        this.handleAgentFailure(data.agentId, data.reason);
      },
    );

    this.agentSpawner.on(
      "agent:heartbeat-missed",
      (data: { agentId: string }) => {
        this.logger.warn(`Agent ${data.agentId} missed heartbeat`);
      },
    );
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      this.logger.warn("Swarm coordinator already running");
      return;
    }

    this.logger.info("Starting swarm coordinator...");
    this.isRunning = true;

    // Initialize components
    if (this.config.enableWorkStealing && !this.workStealer) {
      this.workStealer = new WorkStealingCoordinator({
        checkInterval: this.config.backgroundTaskInterval,
        maxIdleTime: this.config.taskTimeout,
        logger: this.logger,
      });
    }

    if (this.config.enableCircuitBreaker && !this.circuitBreaker) {
      this.circuitBreaker = new CircuitBreaker({
        failureThreshold: 5,
        resetTimeout: 60000,
        monitorInterval: 10000,
      });
    }

    // Start subsystems
    await this.memoryManager.initialize();

    if (this.monitor) {
      await this.monitor.start();
    }

    // Start background workers
    this.startBackgroundWorkers();

    this.emit("coordinator:started");
  }

  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    this.logger.info("Stopping swarm coordinator...");
    this.isRunning = false;

    // Stop background workers
    this.stopBackgroundWorkers();

    // Terminate all running Claude processes
    await this.terminateAllAgentProcesses();

    // Stop subsystems
    if (this.scheduler) {
      await this.scheduler.stop();
    }

    if (this.monitor) {
      this.monitor.stop();
    }

    if (this.workStealer) {
      this.workStealer = undefined;
    }

    if (this.circuitBreaker) {
      this.circuitBreaker = undefined;
    }

    this.emit("coordinator:stopped");
  }

  async shutdown(): Promise<void> {
    this.logger.info("Shutting down swarm coordinator...");
    await this.stop();
  }

  private async terminateAllAgentProcesses(): Promise<void> {
    const terminationPromises: Promise<void>[] = [];

    for (const [agentId, agent] of this.agents) {
      if (agent.process && !agent.process.killed) {
        terminationPromises.push(this.terminateAgentProcess(agent));
      }
    }

    if (terminationPromises.length > 0) {
      this.logger.info(
        `Terminating ${terminationPromises.length} running Claude processes...`,
      );
      await Promise.all(terminationPromises);
    }
  }

  private async terminateAgentProcess(agent: SwarmAgent): Promise<void> {
    return new Promise<void>((resolve) => {
      if (!agent.process || agent.process.killed) {
        resolve();
        return;
      }

      const timeout = setTimeout(() => {
        if (!agent.process?.killed) {
          this.logger.warn(
            `Force killing unresponsive Claude process for agent ${agent.id}`,
          );
          agent.process?.kill("SIGKILL");
        }
        resolve();
      }, 5000);

      agent.process.on("exit", () => {
        clearTimeout(timeout);
        agent.process = undefined;
        agent.processId = undefined;
        agent.instanceId = undefined;
        resolve();
      });

      this.logger.info(
        `Terminating Claude process for agent ${agent.id} (PID: ${agent.processId})`,
      );
      agent.process.kill("SIGTERM");
    });
  }

  private startBackgroundWorkers(): void {
    // Task processor worker
    const taskProcessor = setInterval(() => {
      this.processBackgroundTasks();
    }, this.config.backgroundTaskInterval);
    this.backgroundWorkers.set("taskProcessor", taskProcessor);

    // Health check worker
    const healthChecker = setInterval(() => {
      this.performHealthChecks();
    }, this.config.healthCheckInterval);
    this.backgroundWorkers.set("healthChecker", healthChecker);

    // Work stealing worker
    if (this.workStealer) {
      const workStealerWorker = setInterval(() => {
        this.performWorkStealing();
      }, this.config.backgroundTaskInterval);
      this.backgroundWorkers.set("workStealer", workStealerWorker);
    }

    // Memory sync worker
    const memorySync = setInterval(() => {
      this.syncMemoryState();
    }, this.config.backgroundTaskInterval * 2);
    this.backgroundWorkers.set("memorySync", memorySync);
  }

  private stopBackgroundWorkers(): void {
    for (const [name, worker] of this.backgroundWorkers) {
      clearInterval(worker);
      this.logger.debug(`Stopped background worker: ${name}`);
    }
    this.backgroundWorkers.clear();
  }

  async createObjective(
    description: string,
    strategy: SwarmObjective["strategy"] = "auto",
  ): Promise<string> {
    const objectiveId = generateId("objective");
    const objective: SwarmObjective = {
      id: objectiveId,
      description,
      strategy,
      tasks: [],
      status: "planning",
      createdAt: new Date(),
    };

    this.objectives.set(objectiveId, objective);
    this.logger.info(`Created objective: ${objectiveId} - ${description}`);

    // Decompose objective into tasks
    const tasks = await this.decomposeObjective(objective);
    objective.tasks = tasks;

    // Store in memory
    await this.memoryManager.store({
      id: objectiveId,
      agentId: "coordinator",
      sessionId: this.config.memoryNamespace,
      type: "observation",
      content: JSON.stringify(objective),
      context: {
        objectiveType: "objective",
        strategy,
        taskCount: tasks.length,
      },
      timestamp: new Date(),
      tags: ["objective", strategy],
      version: 1,
    });

    this.emit("objective:created", objective);
    return objectiveId;
  }

  private async decomposeObjective(
    objective: SwarmObjective,
  ): Promise<SwarmTask[]> {
    const tasks: SwarmTask[] = [];

    switch (objective.strategy) {
      case "research":
        tasks.push(
          this.createTask(
            "research",
            "Gather information and research materials",
            1,
          ),
          this.createTask("analysis", "Analyze research findings", 2, [
            "research",
          ]),
          this.createTask(
            "synthesis",
            "Synthesize insights and create report",
            3,
            ["analysis"],
          ),
        );
        break;

      case "development":
        tasks.push(
          this.createTask("planning", "Plan architecture and design", 1),
          this.createTask("implementation", "Implement core functionality", 2, [
            "planning",
          ]),
          this.createTask("testing", "Test and validate implementation", 3, [
            "implementation",
          ]),
          this.createTask("documentation", "Create documentation", 3, [
            "implementation",
          ]),
          this.createTask("review", "Peer review and refinement", 4, [
            "testing",
            "documentation",
          ]),
        );
        break;

      case "analysis":
        tasks.push(
          this.createTask("data-collection", "Collect and prepare data", 1),
          this.createTask("analysis", "Perform detailed analysis", 2, [
            "data-collection",
          ]),
          this.createTask("visualization", "Create visualizations", 3, [
            "analysis",
          ]),
          this.createTask("reporting", "Generate final report", 4, [
            "analysis",
            "visualization",
          ]),
        );
        break;

      default: // auto
        // Use AI to decompose based on objective description
        tasks.push(
          this.createTask(
            "exploration",
            "Explore and understand requirements",
            1,
          ),
          this.createTask("planning", "Create execution plan", 2, [
            "exploration",
          ]),
          this.createTask("execution", "Execute main tasks", 3, ["planning"]),
          this.createTask("validation", "Validate and test results", 4, [
            "execution",
          ]),
          this.createTask("completion", "Finalize and document", 5, [
            "validation",
          ]),
        );
    }

    // Register tasks
    tasks.forEach((task) => {
      this.tasks.set(task.id, task);
    });

    return tasks;
  }

  private createTask(
    type: string,
    description: string,
    priority: number,
    dependencies: string[] = [],
  ): SwarmTask {
    return {
      id: generateId("task"),
      type,
      description,
      priority,
      dependencies,
      status: "pending",
      createdAt: new Date(),
      retryCount: 0,
      maxRetries: this.config.maxRetries,
      timeout: this.config.taskTimeout,
    };
  }

  async registerAgent(
    name: string,
    type: SwarmAgent["type"],
    capabilities: string[] = [],
    spawnProcess: boolean = true,
  ): Promise<string> {
    try {
      let agentId: string;

      if (spawnProcess) {
        // Spawn actual Claude process
        agentId = await this.agentSpawner.spawnAgent({
          name,
          type,
          capabilities,
          mcpConfig: "./mcp_config/mcp.json",
          claudeArgs: ["--no-permissions"],
          environment: {
            CLAUDE_FLOW_MODE: "agent",
            CLAUDE_FLOW_SWARM: this.config.memoryNamespace,
          },
        });

        // Get the spawned agent process info
        const agentProcess = this.agentSpawner.getAgent(agentId);
        if (!agentProcess) {
          throw new Error("Failed to get spawned agent process");
        }
      } else {
        // Register without spawning (for testing or mock agents)
        agentId = generateId("agent");
      }

      const agent: SwarmAgent = {
        id: agentId,
        name,
        type,
        status: "idle",
        capabilities,
        processId: spawnProcess
          ? this.agentSpawner.getAgent(agentId)?.pid
          : undefined,
        metrics: {
          tasksCompleted: 0,
          tasksFailed: 0,
          totalDuration: 0,
          lastActivity: new Date(),
        },
      };

      this.agents.set(agentId, agent);

      if (this.monitor) {
        this.monitor.registerAgent(agentId, name);
      }

      // Register with work stealer if enabled
      if (this.workStealer) {
        this.workStealer.registerWorker(agentId, 1);
      }

      this.logger.info(
        `Registered agent: ${name} (${agentId}) - Type: ${type}, PID: ${agent.processId || "N/A"}`,
      );
      this.emit("agent:registered", agent);

      return agentId;
    } catch (error) {
      this.logger.error(`Failed to register agent ${name}:`, error);
      throw error;
    }
  }

  async assignTask(taskId: string, agentId: string): Promise<void> {
    const task = this.tasks.get(taskId);
    const agent = this.agents.get(agentId);

    if (!task || !agent) {
      throw new Error("Task or agent not found");
    }

    if (agent.status !== "idle") {
      throw new Error("Agent is not available");
    }

    // Check circuit breaker
    if (this.circuitBreaker && !this.circuitBreaker.canExecute(agentId)) {
      throw new Error("Agent circuit breaker is open");
    }

    task.assignedTo = agentId;
    task.status = "running";
    task.startedAt = new Date();

    agent.status = "busy";
    agent.currentTask = task;

    if (this.monitor) {
      this.monitor.taskStarted(agentId, taskId, task.description);
    }

    this.logger.info(`Assigned task ${taskId} to agent ${agentId}`);
    this.emit("task:assigned", { task, agent });

    // Execute task in background
    this.executeTask(task, agent);
  }

  private async executeTask(task: SwarmTask, agent: SwarmAgent): Promise<void> {
    try {
      // Check if agent has a spawned process
      const agentProcess = this.agentSpawner.getAgent(agent.id);

      if (agentProcess && agentProcess.status === "running") {
        // Send task via IPC to spawned agent
        await this.agentSpawner.sendMessage(agent.id, {
          type: "execute-task",
          task: {
            id: task.id,
            type: task.type,
            description: task.description,
            tools: task.tools,
            timeout: task.timeout,
          },
        });

        // The task completion will be handled via agent event handlers
        this.logger.info(`Sent task ${task.id} to agent ${agent.id} via IPC`);
      } else {
        // Fallback to direct Claude execution (legacy mode)
        const result = await this.executeClaudeTask(task, agent);
        await this.handleTaskCompleted(task.id, result);
      }
    } catch (error) {
      await this.handleTaskFailed(task.id, error);
    }
  }

  private async executeClaudeTask(
    task: SwarmTask,
    agent: SwarmAgent,
  ): Promise<any> {
    return new Promise((resolve, reject) => {
      try {
        // Generate instance ID for this task execution
        const instanceId = generateId("claude");
        agent.instanceId = instanceId;

        // Build Claude command arguments
        const claudeArgs = this.buildClaudeArgs(task, agent);

        this.logger.info(`Spawning Claude process for task ${task.id}`, {
          agentId: agent.id,
          instanceId,
          claudeArgs,
        });

        // Spawn Claude process
        const claudeProcess = spawn("claude", claudeArgs, {
          env: {
            ...process.env,
            CLAUDE_INSTANCE_ID: instanceId,
            CLAUDE_AGENT_ID: agent.id,
            CLAUDE_TASK_ID: task.id,
            CLAUDE_TASK_TYPE: task.type,
            CLAUDE_FLOW_MODE: "swarm",
          },
        });

        // Store process reference
        agent.process = claudeProcess;
        agent.processId = claudeProcess.pid;

        let output = "";
        let errorOutput = "";

        // Capture stdout
        claudeProcess.stdout?.on("data", (data) => {
          output += data.toString();
          this.emit("task:progress", {
            taskId: task.id,
            agentId: agent.id,
            output: data.toString(),
          });
        });

        // Capture stderr
        claudeProcess.stderr?.on("data", (data) => {
          errorOutput += data.toString();
          this.logger.warn(
            `Claude stderr for task ${task.id}:`,
            data.toString(),
          );
        });

        // Handle process exit
        claudeProcess.on("exit", (code, signal) => {
          agent.process = undefined;
          agent.processId = undefined;
          agent.instanceId = undefined;

          if (code === 0) {
            this.logger.info(
              `Claude process completed successfully for task ${task.id}`,
            );
            resolve({
              taskId: task.id,
              agentId: agent.id,
              instanceId,
              result: output,
              exitCode: code,
              timestamp: new Date(),
            });
          } else {
            const error = new Error(
              `Claude process exited with code ${code}${signal ? ` (signal: ${signal})` : ""}`,
            );
            this.logger.error(`Claude process failed for task ${task.id}:`, {
              exitCode: code,
              signal,
              stderr: errorOutput,
            });
            reject(error);
          }
        });

        // Handle process errors
        claudeProcess.on("error", (error) => {
          agent.process = undefined;
          agent.processId = undefined;
          agent.instanceId = undefined;

          this.logger.error(
            `Failed to spawn Claude process for task ${task.id}:`,
            error,
          );
          reject(
            new TaskExecutionError(
              `Failed to spawn Claude process: ${error.message}`,
              task.id,
            ),
          );
        });

        // Set up timeout
        const timeoutHandle = setTimeout(() => {
          if (claudeProcess && !claudeProcess.killed) {
            this.logger.warn(
              `Task ${task.id} timed out, killing Claude process`,
            );
            claudeProcess.kill("SIGTERM");

            // Force kill if it doesn't respond to SIGTERM
            setTimeout(() => {
              if (!claudeProcess.killed) {
                claudeProcess.kill("SIGKILL");
              }
            }, 5000);

            reject(
              new TaskExecutionError(
                `Task execution timed out after ${task.timeout || this.config.taskTimeout}ms`,
                task.id,
              ),
            );
          }
        }, task.timeout || this.config.taskTimeout);

        // Clear timeout when process exits
        claudeProcess.on("exit", () => {
          clearTimeout(timeoutHandle);
        });
      } catch (error) {
        reject(
          new TaskExecutionError(
            `Failed to execute Claude task: ${error.message}`,
            task.id,
          ),
        );
      }
    });
  }

  private buildClaudeArgs(task: SwarmTask, agent: SwarmAgent): string[] {
    const args = [task.description];

    // Add tools based on agent type and task requirements
    const tools = this.selectToolsForTask(task, agent);
    if (tools.length > 0) {
      args.push("--allowedTools", tools.join(","));
    }

    // Add permissions flag
    if (task.skipPermissions) {
      args.push("--dangerously-skip-permissions");
    }

    // Add MCP config if specified
    if (task.mcpConfig) {
      args.push("--mcp-config", task.mcpConfig);
    }

    // Add custom arguments if specified
    if (task.claudeArgs) {
      args.push(...task.claudeArgs);
    }

    return args;
  }

  private selectToolsForTask(task: SwarmTask, agent: SwarmAgent): string[] {
    // If task specifies tools, use those
    if (task.tools) {
      return task.tools;
    }

    // Otherwise, select tools based on agent type and task type
    const baseTool = [
      "View",
      "Edit",
      "Replace",
      "GlobTool",
      "GrepTool",
      "LS",
      "Bash",
    ];
    const additionalTools: string[] = [];

    // Agent-specific tools
    switch (agent.type) {
      case "researcher":
        additionalTools.push("WebFetchTool", "WebSearch");
        break;
      case "developer":
        additionalTools.push("BatchTool", "GitTool");
        break;
      case "analyzer":
        additionalTools.push("DataTool", "ChartTool");
        break;
      case "reviewer":
        additionalTools.push("DiffTool", "LintTool");
        break;
      case "coordinator":
        additionalTools.push("BatchTool", "dispatch_agent");
        break;
    }

    // Task-specific tools
    if (task.type.includes("research") || task.type.includes("exploration")) {
      additionalTools.push("WebFetchTool", "WebSearch");
    }
    if (task.type.includes("implement") || task.type.includes("development")) {
      additionalTools.push("BatchTool", "GitTool");
    }
    if (task.type.includes("test") || task.type.includes("validation")) {
      additionalTools.push("TestTool", "LintTool");
    }

    return [...baseTool, ...additionalTools];
  }

  private async handleTaskCompleted(
    taskId: string,
    result: any,
  ): Promise<void> {
    const task = this.tasks.get(taskId);
    if (!task) return;

    const agent = task.assignedTo ? this.agents.get(task.assignedTo) : null;

    task.status = "completed";
    task.completedAt = new Date();
    task.result = result;

    if (agent) {
      agent.status = "idle";
      agent.currentTask = undefined;
      agent.metrics.tasksCompleted++;
      agent.metrics.totalDuration +=
        task.completedAt.getTime() - (task.startedAt?.getTime() || 0);
      agent.metrics.lastActivity = new Date();

      if (this.monitor) {
        this.monitor.taskCompleted(agent.id, taskId);
      }

      if (this.circuitBreaker) {
        this.circuitBreaker.recordSuccess(agent.id);
      }
    }

    // Store result in memory
    await this.memoryManager.store({
      id: generateId(),
      agentId: agent?.id || "coordinator",
      sessionId: this.config.memoryNamespace,
      type: "artifact",
      content: JSON.stringify(result),
      context: {
        itemType: "task-result",
        taskId: taskId,
        taskType: task.type,
      },
      timestamp: new Date(),
      tags: ["task-result", task.type],
      version: 1,
    });

    this.logger.info(`Task ${taskId} completed successfully`);
    this.emit("task:completed", { task, result });

    // Check if objective is complete
    this.checkObjectiveCompletion(task);
  }

  private async handleTaskFailed(taskId: string, error: any): Promise<void> {
    const task = this.tasks.get(taskId);
    if (!task) return;

    const agent = task.assignedTo ? this.agents.get(task.assignedTo) : null;

    task.error = error.message || String(error);
    task.retryCount++;

    if (agent) {
      agent.status = "idle";
      agent.currentTask = undefined;
      agent.metrics.tasksFailed++;
      agent.metrics.lastActivity = new Date();

      if (this.monitor) {
        this.monitor.taskFailed(agent.id, taskId, task.error);
      }

      if (this.circuitBreaker) {
        this.circuitBreaker.recordFailure(agent.id);
      }
    }

    // Retry logic
    if (task.retryCount < task.maxRetries) {
      task.status = "pending";
      task.assignedTo = undefined;
      this.logger.warn(
        `Task ${taskId} failed, will retry (${task.retryCount}/${task.maxRetries})`,
      );
      this.emit("task:retry", { task, error });
    } else {
      task.status = "failed";
      task.completedAt = new Date();
      this.logger.error(
        `Task ${taskId} failed after ${task.retryCount} retries`,
      );
      this.emit("task:failed", { task, error });
    }
  }

  private checkObjectiveCompletion(completedTask: SwarmTask): void {
    for (const [objectiveId, objective] of this.objectives) {
      if (objective.status !== "executing") continue;

      const allTasksComplete = objective.tasks.every((task) => {
        const t = this.tasks.get(task.id);
        return t && (t.status === "completed" || t.status === "failed");
      });

      if (allTasksComplete) {
        objective.status = "completed";
        objective.completedAt = new Date();
        this.logger.info(`Objective ${objectiveId} completed`);
        this.emit("objective:completed", objective);
      }
    }
  }

  private async processBackgroundTasks(): Promise<void> {
    if (!this.isRunning) return;

    try {
      // Process pending tasks
      const pendingTasks = Array.from(this.tasks.values()).filter(
        (t) => t.status === "pending" && this.areDependenciesMet(t),
      );

      // Get available agents
      const availableAgents = Array.from(this.agents.values()).filter(
        (a) => a.status === "idle",
      );

      // Assign tasks to agents
      for (const task of pendingTasks) {
        if (availableAgents.length === 0) break;

        const agent = this.selectBestAgent(task, availableAgents);
        if (agent) {
          try {
            await this.assignTask(task.id, agent.id);
            availableAgents.splice(availableAgents.indexOf(agent), 1);
          } catch (error) {
            this.logger.error(`Failed to assign task ${task.id}:`, error);
          }
        }
      }
    } catch (error) {
      this.logger.error("Error processing background tasks:", error);
    }
  }

  private areDependenciesMet(task: SwarmTask): boolean {
    return task.dependencies.every((depId) => {
      const dep = this.tasks.get(depId);
      return dep && dep.status === "completed";
    });
  }

  private async scheduleTaskRetry(
    task: SwarmTask,
    error: TaskExecutionError,
  ): Promise<void> {
    try {
      // Increment retry count
      task.retryCount = (task.retryCount || 0) + 1;

      // Check if we've exceeded max retries
      const maxRetries = 3;
      if (task.retryCount > maxRetries) {
        task.status = "failed";
        task.result = {
          success: false,
          output: `Task failed after ${maxRetries} attempts`,
          error: error.message,
        };

        this.emit("task:failed", {
          taskId: task.id,
          error,
          userMessage: `Task "${task.description}" could not be completed after multiple attempts.`,
        });

        return;
      }

      // Schedule retry with exponential backoff
      const retryDelay = Math.min(
        1000 * Math.pow(2, task.retryCount - 1),
        30000,
      ); // Max 30s

      setTimeout(() => {
        if (this.tasks.has(task.id) && task.status === "pending") {
          this.logger.info(
            `Retrying task ${task.id} (attempt ${task.retryCount + 1})`,
          );
        }
      }, retryDelay);
    } catch (retryError) {
      this.logger.error("Failed to schedule task retry", {
        taskId: task.id,
        originalError: error,
        retryError,
      });
    }
  }

  private selectBestAgent(
    task: SwarmTask,
    availableAgents: SwarmAgent[],
  ): SwarmAgent | null {
    // Simple selection based on task type and agent capabilities
    const compatibleAgents = availableAgents.filter((agent) => {
      // Match task type to agent type
      if (task.type.includes("research") && agent.type === "researcher")
        return true;
      if (task.type.includes("implement") && agent.type === "developer")
        return true;
      if (task.type.includes("analysis") && agent.type === "analyzer")
        return true;
      if (task.type.includes("review") && agent.type === "reviewer")
        return true;
      return agent.type === "coordinator"; // Coordinator can do any task
    });

    if (compatibleAgents.length === 0) {
      return availableAgents[0]; // Fallback to any available agent
    }

    // Select agent with best performance metrics
    return compatibleAgents.reduce((best, agent) => {
      const bestRatio =
        best.metrics.tasksCompleted / (best.metrics.tasksFailed + 1);
      const agentRatio =
        agent.metrics.tasksCompleted / (agent.metrics.tasksFailed + 1);
      return agentRatio > bestRatio ? agent : best;
    });
  }

  private async performHealthChecks(): Promise<void> {
    if (!this.isRunning) return;

    try {
      const now = new Date();

      for (const [agentId, agent] of this.agents) {
        // Check for stalled agents
        if (agent.status === "busy" && agent.currentTask) {
          const taskDuration =
            now.getTime() - (agent.currentTask.startedAt?.getTime() || 0);
          if (taskDuration > this.config.taskTimeout) {
            this.logger.warn(
              `Agent ${agentId} appears stalled on task ${agent.currentTask.id}`,
            );
            await this.handleTaskFailed(
              agent.currentTask.id,
              new Error("Task timeout"),
            );
          }
        }

        // Check agent health
        const inactivityTime =
          now.getTime() - agent.metrics.lastActivity.getTime();
        if (inactivityTime > this.config.healthCheckInterval * 3) {
          this.logger.warn(
            `Agent ${agentId} has been inactive for ${Math.round(inactivityTime / 1000)}s`,
          );
        }
      }
    } catch (error) {
      this.logger.error("Error performing health checks:", error);
    }
  }

  private async performWorkStealing(): Promise<void> {
    if (!this.isRunning || !this.workStealer) return;

    try {
      // Get agent workloads
      const workloads = new Map<string, number>();
      for (const [agentId, agent] of this.agents) {
        workloads.set(agentId, agent.status === "busy" ? 1 : 0);
      }

      // Update work stealer
      this.workStealer.updateLoads(workloads);

      // Check for work stealing opportunities
      const stealingSuggestions = this.workStealer.suggestWorkStealing();

      for (const suggestion of stealingSuggestions) {
        this.logger.debug(
          `Work stealing suggestion: ${suggestion.from} -> ${suggestion.to}`,
        );
        // In a real implementation, we would reassign tasks here
      }
    } catch (error) {
      this.logger.error("Error performing work stealing:", error);
    }
  }

  private async syncMemoryState(): Promise<void> {
    if (!this.isRunning) return;

    try {
      // Sync current state to memory
      const state = {
        objectives: Array.from(this.objectives.values()),
        tasks: Array.from(this.tasks.values()),
        agents: Array.from(this.agents.values()).map((a) => ({
          ...a,
          currentTask: undefined, // Don't store transient state
        })),
        timestamp: new Date(),
      };

      await this.memoryManager.store({
        id: generateId(),
        agentId: "coordinator",
        sessionId: this.config.memoryNamespace,
        type: "observation",
        content: JSON.stringify(state),
        context: {
          itemType: "swarm-state",
          objectiveCount: state.objectives.length,
          taskCount: state.tasks.length,
          agentCount: state.agents.length,
        },
        timestamp: new Date(),
        tags: ["swarm-state", "system"],
        version: 1,
      });
    } catch (error) {
      this.logger.error("Error syncing memory state:", error);
    }
  }

  private handleMonitorAlert(alert: any): void {
    this.logger.warn(`Monitor alert: ${alert.message}`);
    this.emit("monitor:alert", alert);
  }

  private handleAgentMessage(message: Message): void {
    this.logger.debug(`Agent message: ${message.type} from ${message.from}`);
    this.emit("agent:message", message);
  }

  // Public API methods
  async executeObjective(objectiveId: string): Promise<void> {
    const objective = this.objectives.get(objectiveId);
    if (!objective) {
      throw new Error("Objective not found");
    }

    objective.status = "executing";
    this.logger.info(`Executing objective: ${objectiveId}`);
    this.emit("objective:started", objective);

    // Tasks will be processed by background workers
  }

  async sendMessageToAgent(agentId: string, message: any): Promise<void> {
    const agent = this.agents.get(agentId);
    if (!agent || !agent.process) {
      throw new Error(`Agent ${agentId} not found or not running`);
    }

    try {
      // Send message to Claude process via stdin
      if (agent.process.stdin) {
        agent.process.stdin.write(JSON.stringify(message) + "\n");
        this.logger.debug(`Sent message to agent ${agentId}:`, message);
      }
    } catch (error) {
      this.logger.error(`Failed to send message to agent ${agentId}:`, error);
      throw new CoordinationError(
        `Failed to send message to agent: ${error.message}`,
        agentId,
      );
    }
  }

  async broadcastMessage(
    message: any,
    excludeAgents: string[] = [],
  ): Promise<void> {
    const promises: Promise<void>[] = [];

    for (const [agentId, agent] of this.agents) {
      if (!excludeAgents.includes(agentId) && agent.process) {
        promises.push(
          this.sendMessageToAgent(agentId, message).catch((error) => {
            this.logger.error(
              `Failed to broadcast message to agent ${agentId}:`,
              error,
            );
          }),
        );
      }
    }

    await Promise.all(promises);
    this.logger.debug(`Broadcasted message to ${promises.length} agents`);
  }

  async getTaskProgress(taskId: string): Promise<any> {
    const task = this.tasks.get(taskId);
    if (!task) {
      throw new Error("Task not found");
    }

    const agent = task.assignedTo ? this.agents.get(task.assignedTo) : null;
    const progress = {
      task: {
        id: task.id,
        type: task.type,
        description: task.description,
        status: task.status,
        progress: this.calculateTaskProgress(task),
        startedAt: task.startedAt,
        estimatedCompletion: this.estimateTaskCompletion(task),
      },
      agent: agent
        ? {
            id: agent.id,
            name: agent.name,
            type: agent.type,
            status: agent.status,
            processId: agent.processId,
            instanceId: agent.instanceId,
          }
        : null,
    };

    return progress;
  }

  private calculateTaskProgress(task: SwarmTask): number {
    // Simple progress calculation based on status and time
    switch (task.status) {
      case "pending":
        return 0;
      case "running":
        if (task.startedAt) {
          const elapsed = Date.now() - task.startedAt.getTime();
          const timeout = task.timeout || this.config.taskTimeout;
          return Math.min(50, (elapsed / timeout) * 100); // Max 50% for running tasks
        }
        return 10;
      case "completed":
        return 100;
      case "failed":
        return 0;
      default:
        return 0;
    }
  }

  private estimateTaskCompletion(task: SwarmTask): Date | null {
    if (task.status !== "running" || !task.startedAt) {
      return null;
    }

    const elapsed = Date.now() - task.startedAt.getTime();
    const timeout = task.timeout || this.config.taskTimeout;

    // Simple estimation: if we're at 25% progress, estimate remaining time
    const progress = this.calculateTaskProgress(task);
    if (progress > 0) {
      const estimatedTotal = (elapsed / progress) * 100;
      return new Date(task.startedAt.getTime() + estimatedTotal);
    }

    // Fallback: use timeout as estimate
    return new Date(task.startedAt.getTime() + timeout);
  }

  getObjectiveStatus(objectiveId: string): SwarmObjective | undefined {
    return this.objectives.get(objectiveId);
  }

  getAgentStatus(agentId: string): SwarmAgent | undefined {
    return this.agents.get(agentId);
  }

  getSwarmStatus(): {
    objectives: number;
    tasks: {
      total: number;
      pending: number;
      running: number;
      completed: number;
      failed: number;
    };
    agents: { total: number; idle: number; busy: number; failed: number };
    uptime: number;
  } {
    const tasks = Array.from(this.tasks.values());
    const agents = Array.from(this.agents.values());

    return {
      objectives: this.objectives.size,
      tasks: {
        total: tasks.length,
        pending: tasks.filter((t) => t.status === "pending").length,
        running: tasks.filter((t) => t.status === "running").length,
        completed: tasks.filter((t) => t.status === "completed").length,
        failed: tasks.filter((t) => t.status === "failed").length,
      },
      agents: {
        total: agents.length,
        idle: agents.filter((a) => a.status === "idle").length,
        busy: agents.filter((a) => a.status === "busy").length,
        failed: agents.filter((a) => a.status === "failed").length,
      },
      uptime: this.monitor ? this.monitor.getSummary().uptime : 0,
    };
  }

  /**
   * Handle agent task completion via IPC
   */
  private async handleAgentTaskComplete(
    agentId: string,
    data: any,
  ): Promise<void> {
    const agent = this.agents.get(agentId);
    if (!agent || !agent.currentTask) {
      this.logger.warn(
        `Task completion from agent ${agentId} with no current task`,
      );
      return;
    }

    const task = agent.currentTask;
    await this.handleTaskCompleted(task.id, data.result || data);
  }

  /**
   * Handle agent errors
   */
  private async handleAgentError(agentId: string, error: any): Promise<void> {
    const agent = this.agents.get(agentId);
    if (!agent) {
      return;
    }

    if (agent.currentTask) {
      await this.handleTaskFailed(agent.currentTask.id, error);
    }

    // Update agent status
    agent.status = "failed";
    this.emit("agent:error", { agentId, error });
  }

  /**
   * Handle agent failure (process crash, heartbeat timeout, etc.)
   */
  private async handleAgentFailure(
    agentId: string,
    reason: string,
  ): Promise<void> {
    const agent = this.agents.get(agentId);
    if (!agent) {
      return;
    }

    this.logger.error(`Agent ${agentId} failed: ${reason}`);
    agent.status = "failed";

    // Handle any in-progress task
    if (agent.currentTask) {
      await this.handleTaskFailed(
        agent.currentTask.id,
        new Error(`Agent failed: ${reason}`),
      );
    }

    // Record failure with circuit breaker
    if (this.circuitBreaker) {
      this.circuitBreaker.recordFailure(agentId);
    }

    // Attempt recovery
    if (this.config.maxRetries > 0) {
      this.logger.info(`Attempting to recover agent ${agentId}`);
      try {
        // Re-spawn the agent
        await this.agentSpawner.terminateAgent(agentId, false);
        await this.registerAgent(
          agent.name,
          agent.type,
          agent.capabilities,
          true,
        );
        this.logger.info(`Agent ${agentId} recovered successfully`);
      } catch (error) {
        this.logger.error(`Failed to recover agent ${agentId}:`, error);
      }
    }
  }

  /**
   * Terminate all agent processes during shutdown
   */
  private async terminateAllAgentProcesses(): Promise<void> {
    try {
      await this.agentSpawner.terminateAll(true);
      this.logger.info("All agent processes terminated");
    } catch (error) {
      this.logger.error("Error terminating agent processes:", error);
    }
  }
}
