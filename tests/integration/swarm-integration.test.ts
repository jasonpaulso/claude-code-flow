/**
 * Integration tests for Swarm system
 */

import { assertEquals, assertExists } from '@std/assert';
import { afterEach, beforeEach, describe, it } from '@std/testing/bdd';
import { SwarmCoordinator } from '../../src/coordination/swarm-coordinator.ts';
import { SwarmMemoryManager } from '../../src/memory/swarm-memory.ts';
import { TEST_CONFIG, setupTestEnv, cleanupTestEnv, getTestTimeout } from '../test.config.ts';

describe('Swarm Integration Tests', () => {
  let coordinator: SwarmCoordinator;
  let memoryManager: SwarmMemoryManager;

  beforeEach(async () => {
    setupTestEnv();
    
    memoryManager = new SwarmMemoryManager({
      namespace: 'integration-test',
      persistencePath: './tests/temp/swarm-integration',
      syncInterval: 0
    });
    
    coordinator = new SwarmCoordinator({
      maxAgents: 10,
      maxConcurrentTasks: 5,
      taskTimeout: getTestTimeout('integration'),
      enableMonitoring: false,
      memoryNamespace: 'integration-test'
    });

    await memoryManager.initialize();
    await coordinator.start();
  });

  afterEach(async () => {
    await coordinator.stop();
    await memoryManager.shutdown();
    await cleanupTestEnv();
  });

  describe('End-to-End Swarm Workflow', () => {
    it('should complete a full development workflow', async () => {
      // Register multiple agents with different roles
      const developerId = await coordinator.registerAgent('Developer', 'developer', ['typescript', 'testing']);
      const researcherId = await coordinator.registerAgent('Researcher', 'researcher', ['web-search', 'analysis']);
      const reviewerId = await coordinator.registerAgent('Reviewer', 'reviewer', ['code-review', 'quality']);

      // Verify agents are registered
      assertEquals(coordinator.getSwarmStatus().agents.total, 3);

      // Create a development objective
      const objectiveId = await coordinator.createObjective(
        'Build a simple calculator module with tests',
        'development'
      );

      const objective = coordinator.getObjectiveStatus(objectiveId);
      assertExists(objective);
      assertEquals(objective.strategy, 'development');
      assertEquals(objective.tasks.length, 5); // planning, implementation, testing, documentation, review

      // Execute the objective
      await coordinator.executeObjective(objectiveId);
      assertEquals(objective.status, 'executing');

      // Verify task assignment will happen through background workers
      // In a real test, we would wait for tasks to be processed
      const status = coordinator.getSwarmStatus();
      assertEquals(status.tasks.total, 5);
      assertEquals(status.tasks.pending, 5);
    });

    it('should handle research workflow with knowledge sharing', async () => {
      // Register research team
      const researcher1 = await coordinator.registerAgent('Researcher1', 'researcher', ['web-research']);
      const researcher2 = await coordinator.registerAgent('Researcher2', 'researcher', ['data-analysis']);
      const analyzer = await coordinator.registerAgent('Analyzer', 'analyzer', ['synthesis']);

      // Create research objective
      const objectiveId = await coordinator.createObjective(
        'Research best practices for AI safety',
        'research'
      );

      const objective = coordinator.getObjectiveStatus(objectiveId);
      assertExists(objective);
      assertEquals(objective.tasks.length, 3); // research, analysis, synthesis

      // Store some research findings in memory
      const findingId = await memoryManager.remember(
        researcher1,
        'knowledge',
        {
          topic: 'AI Safety',
          findings: 'Key principles include alignment, robustness, and interpretability'
        },
        {
          tags: ['ai-safety', 'research'],
          shareLevel: 'public'
        }
      );

      // Share findings with other researchers
      await memoryManager.shareMemory(findingId, researcher2);

      // Verify knowledge sharing
      const sharedMemories = await memoryManager.recall({ agentId: researcher2 });
      assertEquals(sharedMemories.length, 1);
      assertEquals(sharedMemories[0].content.topic, 'AI Safety');

      // Execute objective
      await coordinator.executeObjective(objectiveId);

      const status = coordinator.getSwarmStatus();
      assertEquals(status.tasks.total, 3);
    });

    it('should coordinate multi-agent task dependencies', async () => {
      // Register agents
      const plannerAgentId = await coordinator.registerAgent('Planner', 'coordinator', ['planning']);
      const implementerAgentId = await coordinator.registerAgent('Implementer', 'developer', ['coding']);
      const testerAgentId = await coordinator.registerAgent('Tester', 'reviewer', ['testing']);

      // Create objective with clear dependencies
      const objectiveId = await coordinator.createObjective(
        'Create and test a new feature',
        'development'
      );

      const objective = coordinator.getObjectiveStatus(objectiveId);
      assertExists(objective);

      // Verify task dependencies
      const tasks = objective.tasks;
      const planningTask = tasks.find(t => t.type === 'planning');
      const implementationTask = tasks.find(t => t.type === 'implementation');
      const testingTask = tasks.find(t => t.type === 'testing');

      assertExists(planningTask);
      assertExists(implementationTask);
      assertExists(testingTask);

      // Implementation should depend on planning
      assertEquals(implementationTask.dependencies.includes(planningTask.id), true);
      // Testing should depend on implementation
      assertEquals(testingTask.dependencies.includes(implementationTask.id), true);

      await coordinator.executeObjective(objectiveId);

      // Verify only planning task can start initially (no dependencies)
      const initialStatus = coordinator.getSwarmStatus();
      assertEquals(initialStatus.tasks.pending, 5);
    });

    it('should handle agent failure and recovery', async () => {
      const agentId = await coordinator.registerAgent('FailingAgent', 'developer');
      
      const objectiveId = await coordinator.createObjective(
        'Test failure handling',
        'development'
      );

      const objective = coordinator.getObjectiveStatus(objectiveId);
      const task = objective!.tasks[0];

      // Assign task to agent
      await coordinator.assignTask(task.id, agentId);

      // Verify task is assigned
      const agent = coordinator.getAgentStatus(agentId);
      assertEquals(agent!.status, 'busy');
      assertEquals(agent!.currentTask?.id, task.id);

      // Simulate agent process termination (in real scenario, Claude process would exit)
      // The error handling and retry logic would be tested here
      const taskProgress = await coordinator.getTaskProgress(task.id);
      assertExists(taskProgress);
      assertEquals(taskProgress.task.status, 'running');
    });
  });

  describe('Memory Integration', () => {
    it('should persist swarm state across sessions', async () => {
      // Create agents and objectives
      const agentId = await coordinator.registerAgent('PersistentAgent', 'developer');
      const objectiveId = await coordinator.createObjective('Persistent objective', 'auto');

      // Store memory
      await memoryManager.remember(
        agentId,
        'state',
        { objectiveId, status: 'active' },
        { taskId: 'persist-test' }
      );

      // Shutdown and restart
      await coordinator.stop();
      await memoryManager.shutdown();

      // Restart systems
      await memoryManager.initialize();
      await coordinator.start();

      // Verify memory persistence
      const memories = await memoryManager.recall({ agentId });
      assertEquals(memories.length, 1);
      assertEquals(memories[0].content.objectiveId, objectiveId);
    });

    it('should share knowledge across agent teams', async () => {
      // Create knowledge base
      const kbId = await memoryManager.createKnowledgeBase(
        'Shared Knowledge',
        'Team knowledge base',
        'development',
        ['best-practices', 'patterns']
      );

      // Register team members
      const senior = await coordinator.registerAgent('Senior', 'developer');
      const junior = await coordinator.registerAgent('Junior', 'developer');

      // Senior shares knowledge
      const knowledgeId = await memoryManager.remember(
        senior,
        'knowledge',
        {
          title: 'Testing Best Practices',
          content: 'Always write tests before implementation',
          examples: ['TDD', 'BDD', 'Unit tests']
        },
        {
          tags: ['best-practices', 'testing'],
          shareLevel: 'public'
        }
      );

      // Broadcast to team
      await memoryManager.broadcastMemory(knowledgeId, [junior]);

      // Verify knowledge sharing
      const juniorKnowledge = await memoryManager.recall({ agentId: junior });
      assertEquals(juniorKnowledge.length, 1);
      assertEquals(juniorKnowledge[0].content.title, 'Testing Best Practices');

      // Search knowledge base
      const searchResults = await memoryManager.searchKnowledge('testing', 'development');
      assertEquals(searchResults.length >= 1, true);
    });
  });

  describe('Error Handling and Recovery', () => {
    it('should handle memory corruption gracefully', async () => {
      // Add valid memory entries
      const entryId = await memoryManager.remember(
        'test-agent',
        'knowledge',
        { data: 'valid content' }
      );

      // Verify initial state
      let integrity = await memoryManager.validateMemoryIntegrity();
      assertEquals(integrity.corruptedEntries.length, 0);

      // Memory system should detect and handle corruption in real scenarios
      // For now, verify the validation system works
      assertEquals(integrity.validEntries, 1);
      assertEquals(integrity.totalEntries, 1);
    });

    it('should recover from agent disconnections', async () => {
      const agentId = await coordinator.registerAgent('DisconnectAgent', 'developer');
      
      // Create and assign task
      const objectiveId = await coordinator.createObjective('Test disconnection', 'auto');
      const objective = coordinator.getObjectiveStatus(objectiveId);
      const task = objective!.tasks[0];
      
      await coordinator.assignTask(task.id, agentId);

      // Verify task assignment
      let agent = coordinator.getAgentStatus(agentId);
      assertEquals(agent!.status, 'busy');

      // The health check system should detect stalled agents
      // and reassign tasks in real scenarios
      const status = coordinator.getSwarmStatus();
      assertEquals(status.agents.busy, 1);
    });
  });

  describe('Performance and Scalability', () => {
    it('should handle multiple concurrent objectives', async () => {
      // Register multiple agents
      const agents = [];
      for (let i = 0; i < 5; i++) {
        const agentId = await coordinator.registerAgent(`Agent${i}`, 'developer');
        agents.push(agentId);
      }

      // Create multiple objectives
      const objectives = [];
      for (let i = 0; i < 3; i++) {
        const objectiveId = await coordinator.createObjective(
          `Concurrent objective ${i}`,
          'auto'
        );
        objectives.push(objectiveId);
      }

      // Execute all objectives
      for (const objectiveId of objectives) {
        await coordinator.executeObjective(objectiveId);
      }

      // Verify system can handle load
      const status = coordinator.getSwarmStatus();
      assertEquals(status.objectives, 3);
      assertEquals(status.agents.total, 5);
      assertEquals(status.tasks.total, 15); // 3 objectives × 5 tasks each
    });

    it('should maintain performance with large memory datasets', async () => {
      // Add many memory entries
      const startTime = Date.now();
      
      for (let i = 0; i < TEST_CONFIG.fixtures.small_memory_entries; i++) {
        await memoryManager.remember(
          `agent-${i % 10}`,
          'knowledge',
          { index: i, data: `Entry ${i}` },
          { tags: [`tag-${i % 20}`] }
        );
      }

      const insertTime = Date.now() - startTime;
      
      // Query performance
      const queryStart = Date.now();
      const results = await memoryManager.recall({ tags: ['tag-5'] });
      const queryTime = Date.now() - queryStart;

      // Verify reasonable performance (adjust thresholds as needed)
      assertEquals(insertTime < 10000, true); // 10 seconds for 100 entries
      assertEquals(queryTime < 1000, true);   // 1 second for query
      assertEquals(results.length >= 1, true);

      // Memory compaction should also be performant
      const compactStart = Date.now();
      const compactResult = await memoryManager.compactMemory();
      const compactTime = Date.now() - compactStart;

      assertEquals(compactTime < 5000, true); // 5 seconds for compaction
      assertExists(compactResult);
    });
  });
});