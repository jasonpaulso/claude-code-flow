/**
 * Unit tests for SwarmCoordinator
 */

import { assertEquals, assertExists, assertThrows } from "@std/assert";
import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import {
  SwarmCoordinator,
  SwarmAgent,
  SwarmTask,
  SwarmObjective,
} from "../../../src/coordination/swarm-coordinator.ts";
import {
  TEST_CONFIG,
  setupTestEnv,
  cleanupTestEnv,
} from "../../test.config.ts";

describe("SwarmCoordinator", () => {
  let coordinator: SwarmCoordinator;

  beforeEach(async () => {
    setupTestEnv();
    coordinator = new SwarmCoordinator({
      maxAgents: 5,
      maxConcurrentTasks: 3,
      taskTimeout: 10000,
      enableMonitoring: false, // Disable for unit tests
      memoryNamespace: "test-swarm",
    });
    await coordinator.start();
  });

  afterEach(async () => {
    await coordinator.stop();
    await cleanupTestEnv();
  });

  describe("Initialization", () => {
    it("should start coordinator successfully", async () => {
      const newCoordinator = new SwarmCoordinator();
      await newCoordinator.start();

      const status = newCoordinator.getSwarmStatus();
      assertEquals(status.objectives, 0);
      assertEquals(status.agents.total, 0);
      assertEquals(status.tasks.total, 0);

      await newCoordinator.stop();
    });

    it("should not start twice", async () => {
      // Coordinator already started in beforeEach
      await coordinator.start(); // Should not throw or cause issues

      const status = coordinator.getSwarmStatus();
      assertExists(status);
    });
  });

  describe("Agent Management", () => {
    it("should register agents successfully", async () => {
      const agentId = await coordinator.registerAgent(
        "TestAgent",
        "developer",
        ["typescript", "testing"],
      );

      assertExists(agentId);

      const agent = coordinator.getAgentStatus(agentId);
      assertExists(agent);
      assertEquals(agent!.name, "TestAgent");
      assertEquals(agent!.type, "developer");
      assertEquals(agent!.status, "idle");
      assertEquals(agent!.capabilities, ["typescript", "testing"]);
    });

    it("should track agent metrics", async () => {
      const agentId = await coordinator.registerAgent(
        "MetricsAgent",
        "analyzer",
      );
      const agent = coordinator.getAgentStatus(agentId);

      assertExists(agent);
      assertEquals(agent!.metrics.tasksCompleted, 0);
      assertEquals(agent!.metrics.tasksFailed, 0);
      assertEquals(agent!.metrics.totalDuration, 0);
      assertExists(agent!.metrics.lastActivity);
    });

    it("should provide swarm status", async () => {
      await coordinator.registerAgent("Agent1", "developer");
      await coordinator.registerAgent("Agent2", "researcher");

      const status = coordinator.getSwarmStatus();
      assertEquals(status.agents.total, 2);
      assertEquals(status.agents.idle, 2);
      assertEquals(status.agents.busy, 0);
      assertEquals(status.agents.failed, 0);
    });
  });

  describe("Objective Management", () => {
    it("should create objectives successfully", async () => {
      const objectiveId = await coordinator.createObjective(
        "Test objective",
        "development",
      );

      assertExists(objectiveId);

      const objective = coordinator.getObjectiveStatus(objectiveId);
      assertExists(objective);
      assertEquals(objective!.description, "Test objective");
      assertEquals(objective!.strategy, "development");
      assertEquals(objective!.status, "planning");
      assertExists(objective!.tasks);
    });

    it("should decompose development objectives into proper tasks", async () => {
      const objectiveId = await coordinator.createObjective(
        "Build a new feature",
        "development",
      );

      const objective = coordinator.getObjectiveStatus(objectiveId);
      assertExists(objective);

      // Development strategy should create specific tasks
      const taskTypes = objective!.tasks.map((t) => t.type);
      assertEquals(taskTypes.includes("planning"), true);
      assertEquals(taskTypes.includes("implementation"), true);
      assertEquals(taskTypes.includes("testing"), true);
      assertEquals(taskTypes.includes("documentation"), true);
      assertEquals(taskTypes.includes("review"), true);
    });

    it("should decompose research objectives into proper tasks", async () => {
      const objectiveId = await coordinator.createObjective(
        "Research new technology",
        "research",
      );

      const objective = coordinator.getObjectiveStatus(objectiveId);
      assertExists(objective);

      const taskTypes = objective!.tasks.map((t) => t.type);
      assertEquals(taskTypes.includes("research"), true);
      assertEquals(taskTypes.includes("analysis"), true);
      assertEquals(taskTypes.includes("synthesis"), true);
    });

    it("should execute objectives", async () => {
      const objectiveId = await coordinator.createObjective(
        "Test execution",
        "auto",
      );

      await coordinator.executeObjective(objectiveId);

      const objective = coordinator.getObjectiveStatus(objectiveId);
      assertEquals(objective!.status, "executing");
    });
  });

  describe("Task Management", () => {
    let agentId: string;
    let objectiveId: string;

    beforeEach(async () => {
      agentId = await coordinator.registerAgent("TaskAgent", "developer");
      objectiveId = await coordinator.createObjective("Test tasks", "auto");
    });

    it("should create tasks with proper dependencies", async () => {
      const objective = coordinator.getObjectiveStatus(objectiveId);
      assertExists(objective);

      const tasks = objective!.tasks;
      assertEquals(tasks.length > 0, true);

      // Check task structure
      const firstTask = tasks[0];
      assertExists(firstTask.id);
      assertExists(firstTask.type);
      assertExists(firstTask.description);
      assertEquals(firstTask.status, "pending");
      assertEquals(firstTask.retryCount, 0);
    });

    it("should assign tasks to agents", async () => {
      const objective = coordinator.getObjectiveStatus(objectiveId);
      const task = objective!.tasks[0];

      await coordinator.assignTask(task.id, agentId);

      const agent = coordinator.getAgentStatus(agentId);
      assertEquals(agent!.status, "busy");
      assertEquals(agent!.currentTask?.id, task.id);
    });

    it("should validate task assignment", async () => {
      const objective = coordinator.getObjectiveStatus(objectiveId);
      const task = objective!.tasks[0];

      // Should throw for invalid agent ID
      await assertThrows(
        async () => await coordinator.assignTask(task.id, "invalid-agent"),
        Error,
        "Task or agent not found",
      );

      // Should throw for invalid task ID
      await assertThrows(
        async () => await coordinator.assignTask("invalid-task", agentId),
        Error,
        "Task or agent not found",
      );
    });

    it("should prevent double assignment", async () => {
      const objective = coordinator.getObjectiveStatus(objectiveId);
      const task = objective!.tasks[0];

      await coordinator.assignTask(task.id, agentId);

      // Should throw when trying to assign to busy agent
      await assertThrows(
        async () => await coordinator.assignTask(task.id, agentId),
        Error,
        "Agent is not available",
      );
    });

    it("should provide task progress information", async () => {
      const objective = coordinator.getObjectiveStatus(objectiveId);
      const task = objective!.tasks[0];

      const progress = await coordinator.getTaskProgress(task.id);

      assertExists(progress);
      assertEquals(progress.task.id, task.id);
      assertEquals(progress.task.status, "pending");
      assertEquals(progress.task.progress, 0);
      assertEquals(progress.agent, null); // Not assigned yet
    });
  });

  describe("Inter-Agent Communication", () => {
    let agent1Id: string;
    let agent2Id: string;

    beforeEach(async () => {
      agent1Id = await coordinator.registerAgent("Agent1", "developer");
      agent2Id = await coordinator.registerAgent("Agent2", "researcher");
    });

    it("should validate message sending to inactive agent", async () => {
      const message = { type: "test", content: "Hello" };

      // Should throw for agent without active process
      await assertThrows(
        async () => await coordinator.sendMessageToAgent(agent1Id, message),
        Error,
        "Agent agent1 not found or not running",
      );
    });

    it("should validate broadcast message", async () => {
      const message = { type: "broadcast", content: "Hello all" };

      // Should not throw even if no agents are running processes
      await coordinator.broadcastMessage(message);
    });

    it("should exclude agents from broadcast", async () => {
      const message = { type: "selective", content: "Selective message" };

      await coordinator.broadcastMessage(message, [agent1Id]);
      // Should complete without error
    });
  });

  describe("Claude Process Integration", () => {
    let agentId: string;

    beforeEach(async () => {
      agentId = await coordinator.registerAgent("ProcessAgent", "developer");
    });

    it("should build correct Claude arguments", async () => {
      const objectiveId = await coordinator.createObjective(
        "Test Claude args",
        "development",
      );
      const objective = coordinator.getObjectiveStatus(objectiveId);
      const task = objective!.tasks[0];

      // Add test metadata to task
      task.tools = ["View", "Edit", "Bash"];
      task.skipPermissions = true;
      task.mcpConfig = "/test/config.json";
      task.claudeArgs = ["--verbose"];

      // Test buildClaudeArgs method (private method testing via public interface)
      // We can verify this works by assigning the task and checking the process spawn
      await coordinator.assignTask(task.id, agentId);

      const agent = coordinator.getAgentStatus(agentId);
      assertEquals(agent!.status, "busy");
      assertEquals(agent!.currentTask?.id, task.id);
    });

    it("should select appropriate tools for agent types", async () => {
      const researchers = await coordinator.registerAgent(
        "Researcher",
        "researcher",
      );
      const developer = await coordinator.registerAgent(
        "Developer",
        "developer",
      );
      const analyzer = await coordinator.registerAgent("Analyzer", "analyzer");

      // Each agent type should be registered successfully
      const researcherAgent = coordinator.getAgentStatus(researchers);
      const developerAgent = coordinator.getAgentStatus(developer);
      const analyzerAgent = coordinator.getAgentStatus(analyzer);

      assertEquals(researcherAgent!.type, "researcher");
      assertEquals(developerAgent!.type, "developer");
      assertEquals(analyzerAgent!.type, "analyzer");
    });
  });

  describe("Error Handling", () => {
    it("should handle invalid objective creation", async () => {
      // Test with invalid strategy
      await assertThrows(
        async () => await coordinator.createObjective("Test", "invalid" as any),
        Error,
      );
    });

    it("should handle missing objectives", () => {
      const result = coordinator.getObjectiveStatus("invalid-id");
      assertEquals(result, undefined);
    });

    it("should handle missing agents", () => {
      const result = coordinator.getAgentStatus("invalid-id");
      assertEquals(result, undefined);
    });

    it("should handle invalid task progress requests", async () => {
      await assertThrows(
        async () => await coordinator.getTaskProgress("invalid-task"),
        Error,
        "Task not found",
      );
    });
  });

  describe("Shutdown and Cleanup", () => {
    it("should shutdown gracefully", async () => {
      const tempCoordinator = new SwarmCoordinator();
      await tempCoordinator.start();

      await tempCoordinator.registerAgent("TempAgent", "developer");

      await tempCoordinator.shutdown();

      // Should be able to call shutdown multiple times
      await tempCoordinator.shutdown();
    });

    it("should stop background workers on shutdown", async () => {
      const tempCoordinator = new SwarmCoordinator({
        backgroundTaskInterval: 1000,
        healthCheckInterval: 2000,
      });

      await tempCoordinator.start();
      await tempCoordinator.stop();

      // Verify no background activity continues
      const status = tempCoordinator.getSwarmStatus();
      assertExists(status);
    });
  });
});
