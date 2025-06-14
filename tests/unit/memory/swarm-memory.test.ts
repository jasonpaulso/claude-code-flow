/**
 * Unit tests for SwarmMemoryManager
 */

import {
  assertEquals,
  assertExists,
  assertThrows,
  assertArrayIncludes,
} from "@std/assert";
import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import {
  SwarmMemoryManager,
  SwarmMemoryEntry,
} from "../../../src/memory/swarm-memory.ts";
import {
  TEST_CONFIG,
  setupTestEnv,
  cleanupTestEnv,
} from "../../test.config.ts";

describe("SwarmMemoryManager", () => {
  let memoryManager: SwarmMemoryManager;
  const testAgentId = "test-agent-123";

  beforeEach(async () => {
    setupTestEnv();
    memoryManager = new SwarmMemoryManager({
      namespace: "test-memory",
      persistencePath: "./tests/temp/memory",
      maxEntries: 100,
      syncInterval: 0, // Disable auto-sync for tests
    });
    await memoryManager.initialize();
  });

  afterEach(async () => {
    await memoryManager.shutdown();
    await cleanupTestEnv();
  });

  describe("Initialization", () => {
    it("should initialize successfully", async () => {
      const newManager = new SwarmMemoryManager();
      await newManager.initialize();

      const stats = newManager.getMemoryStats();
      assertEquals(stats.totalEntries, 0);
      assertEquals(stats.knowledgeBases, 0);

      await newManager.shutdown();
    });

    it("should not initialize twice", async () => {
      // Already initialized in beforeEach
      await memoryManager.initialize(); // Should not throw

      const stats = memoryManager.getMemoryStats();
      assertExists(stats);
    });
  });

  describe("Memory Entry Management", () => {
    it("should store and retrieve memory entries", async () => {
      const entryId = await memoryManager.remember(
        testAgentId,
        "knowledge",
        { fact: "TypeScript is great" },
        { tags: ["typescript", "programming"] },
      );

      assertExists(entryId);

      const entries = await memoryManager.recall({ agentId: testAgentId });
      assertEquals(entries.length, 1);
      assertEquals(entries[0].id, entryId);
      assertEquals(entries[0].agentId, testAgentId);
      assertEquals(entries[0].type, "knowledge");
      assertEquals(entries[0].content.fact, "TypeScript is great");
    });

    it("should validate memory entry data", async () => {
      // Test invalid agent ID
      await assertThrows(
        async () => await memoryManager.remember("", "knowledge", "content"),
        Error,
        "Invalid agent ID",
      );

      // Test invalid type
      await assertThrows(
        async () =>
          await memoryManager.remember(
            testAgentId,
            "invalid" as any,
            "content",
          ),
        Error,
        "Invalid memory entry type",
      );

      // Test null content
      await assertThrows(
        async () =>
          await memoryManager.remember(testAgentId, "knowledge", null),
        Error,
        "Memory content cannot be null or undefined",
      );

      // Test invalid priority
      await assertThrows(
        async () =>
          await memoryManager.remember(testAgentId, "knowledge", "content", {
            priority: 15,
          }),
        Error,
        "Invalid priority value",
      );

      // Test invalid share level
      await assertThrows(
        async () =>
          await memoryManager.remember(testAgentId, "knowledge", "content", {
            shareLevel: "invalid" as any,
          }),
        Error,
        "Invalid share level",
      );
    });

    it("should generate and validate checksums", async () => {
      const content = { data: "test content", number: 42 };
      const entryId = await memoryManager.remember(
        testAgentId,
        "result",
        content,
      );

      const entries = await memoryManager.recall({ agentId: testAgentId });
      const entry = entries[0];

      assertExists(entry.metadata.checksum);
      assertEquals(entry.metadata.checksum!.length, 64); // SHA-256 hex length
    });

    it("should enforce content size limits", async () => {
      // Create content larger than 1MB
      const largeContent = "x".repeat(1024 * 1024 + 1);

      await assertThrows(
        async () =>
          await memoryManager.remember(testAgentId, "knowledge", largeContent),
        Error,
        "Memory entry content too large",
      );
    });

    it("should set default metadata values", async () => {
      const entryId = await memoryManager.remember(testAgentId, "state", {
        status: "active",
      });

      const entries = await memoryManager.recall({ agentId: testAgentId });
      const entry = entries[0];

      assertEquals(entry.metadata.shareLevel, "team");
      assertEquals(entry.metadata.priority, 1);
      assertEquals(entry.metadata.version, 1);
      assertExists(entry.metadata.checksum);
    });
  });

  describe("Memory Querying", () => {
    beforeEach(async () => {
      // Add test data
      await memoryManager.remember(
        testAgentId,
        "knowledge",
        { topic: "AI" },
        {
          tags: ["ai", "ml"],
          taskId: "task-1",
        },
      );
      await memoryManager.remember(
        testAgentId,
        "result",
        { outcome: "success" },
        {
          tags: ["success"],
          taskId: "task-2",
        },
      );
      await memoryManager.remember(
        "other-agent",
        "knowledge",
        { topic: "web" },
        {
          tags: ["web"],
        },
      );
    });

    it("should filter by agent ID", async () => {
      const entries = await memoryManager.recall({ agentId: testAgentId });
      assertEquals(entries.length, 2);
      entries.forEach((entry) => assertEquals(entry.agentId, testAgentId));
    });

    it("should filter by type", async () => {
      const entries = await memoryManager.recall({ type: "knowledge" });
      assertEquals(entries.length, 2);
      entries.forEach((entry) => assertEquals(entry.type, "knowledge"));
    });

    it("should filter by task ID", async () => {
      const entries = await memoryManager.recall({ taskId: "task-1" });
      assertEquals(entries.length, 1);
      assertEquals(entries[0].metadata.taskId, "task-1");
    });

    it("should filter by tags", async () => {
      const entries = await memoryManager.recall({ tags: ["ai"] });
      assertEquals(entries.length, 1);
      assertEquals(entries[0].content.topic, "AI");
    });

    it("should apply limits", async () => {
      const entries = await memoryManager.recall({ limit: 1 });
      assertEquals(entries.length, 1);
    });

    it("should sort by timestamp (newest first)", async () => {
      const entries = await memoryManager.recall({});
      assertEquals(entries.length, 3);

      for (let i = 1; i < entries.length; i++) {
        const current = entries[i].timestamp.getTime();
        const previous = entries[i - 1].timestamp.getTime();
        assertEquals(current <= previous, true);
      }
    });
  });

  describe("Memory Sharing", () => {
    let entryId: string;
    const targetAgent = "target-agent";

    beforeEach(async () => {
      entryId = await memoryManager.remember(
        testAgentId,
        "knowledge",
        { shareable: "data" },
        { shareLevel: "team" },
      );
    });

    it("should share memory between agents", async () => {
      await memoryManager.shareMemory(entryId, targetAgent);

      const sharedEntries = await memoryManager.recall({
        agentId: targetAgent,
      });
      assertEquals(sharedEntries.length, 1);
      assertEquals(sharedEntries[0].content.shareable, "data");
      assertEquals(sharedEntries[0].metadata.sharedFrom, testAgentId);
      assertEquals(sharedEntries[0].metadata.sharedTo, targetAgent);
    });

    it("should prevent sharing private memories", async () => {
      const privateEntryId = await memoryManager.remember(
        testAgentId,
        "knowledge",
        { private: "data" },
        { shareLevel: "private" },
      );

      await assertThrows(
        async () =>
          await memoryManager.shareMemory(privateEntryId, targetAgent),
        Error,
        "Memory entry is private and cannot be shared",
      );
    });

    it("should broadcast memory to multiple agents", async () => {
      const agent2 = "agent-2";
      const agent3 = "agent-3";

      await memoryManager.broadcastMemory(entryId, [agent2, agent3]);

      const agent2Entries = await memoryManager.recall({ agentId: agent2 });
      const agent3Entries = await memoryManager.recall({ agentId: agent3 });

      assertEquals(agent2Entries.length, 1);
      assertEquals(agent3Entries.length, 1);
    });

    it("should handle non-existent entries", async () => {
      await assertThrows(
        async () => await memoryManager.shareMemory("invalid-id", targetAgent),
        Error,
        "Memory entry not found",
      );
    });
  });

  describe("Knowledge Base Management", () => {
    it("should create knowledge bases", async () => {
      const kbId = await memoryManager.createKnowledgeBase(
        "AI Knowledge",
        "Artificial Intelligence knowledge base",
        "technology",
        ["ai", "ml", "neural-networks"],
      );

      assertExists(kbId);

      const stats = memoryManager.getMemoryStats();
      assertEquals(stats.knowledgeBases, 1);
    });

    it("should update knowledge bases with relevant entries", async () => {
      const kbId = await memoryManager.createKnowledgeBase(
        "ML Knowledge",
        "Machine Learning KB",
        "technology",
        ["ml", "ai"],
      );

      // Add entry with matching tags
      await memoryManager.remember(
        testAgentId,
        "knowledge",
        { topic: "neural networks" },
        { tags: ["ml", "deep-learning"] },
      );

      // Knowledge base should be updated automatically
      const stats = memoryManager.getMemoryStats();
      assertEquals(stats.knowledgeBases, 1);
    });

    it("should search knowledge base content", async () => {
      await memoryManager.createKnowledgeBase(
        "Web Knowledge",
        "Web development KB",
        "web",
        ["html", "css", "javascript"],
      );

      await memoryManager.remember(
        testAgentId,
        "knowledge",
        {
          topic: "HTML forms",
          content: "Forms are essential for web interaction",
        },
        { tags: ["html", "forms"] },
      );

      const results = await memoryManager.searchKnowledge("forms", "web");
      assertEquals(results.length, 1);
      assertEquals(results[0].content.topic, "HTML forms");
    });
  });

  describe("Memory Import/Export", () => {
    beforeEach(async () => {
      // Add test data
      await memoryManager.remember(testAgentId, "knowledge", {
        data: "export test",
      });
      await memoryManager.remember(testAgentId, "result", { success: true });
    });

    it("should export agent memory", async () => {
      const exported = await memoryManager.exportMemory(testAgentId);

      assertExists(exported);
      assertEquals(exported.entries.length, 2);
      assertExists(exported.exportedAt);
      assertExists(exported.stats);
    });

    it("should export all memory", async () => {
      const exported = await memoryManager.exportMemory();

      assertExists(exported);
      assertEquals(exported.entries.length >= 2, true);
      assertExists(exported.knowledgeBases);
    });

    it("should import memory data", async () => {
      const exportData = await memoryManager.exportMemory();

      // Clear memory
      await memoryManager.clearMemory();
      assertEquals(memoryManager.getMemoryStats().totalEntries, 0);

      // Import data
      const result = await memoryManager.importMemory(exportData);

      assertEquals(result.imported > 0, true);
      assertEquals(result.failed, 0);
      assertEquals(result.errors.length, 0);

      const stats = memoryManager.getMemoryStats();
      assertEquals(stats.totalEntries >= 2, true);
    });

    it("should handle invalid import data", async () => {
      await assertThrows(
        async () => await memoryManager.importMemory({ invalid: "data" }),
        Error,
        "Invalid import data",
      );
    });

    it("should handle import conflicts", async () => {
      const exportData = await memoryManager.exportMemory();

      // Import again (should handle conflicts)
      const result = await memoryManager.importMemory(exportData);

      assertEquals(result.imported >= 0, true);
      // Some entries might be created with new IDs to avoid conflicts
    });
  });

  describe("Memory Maintenance", () => {
    beforeEach(async () => {
      // Add test data with duplicates
      const content1 = { data: "duplicate content" };
      const content2 = { data: "unique content" };

      await memoryManager.remember(testAgentId, "knowledge", content1);
      await memoryManager.remember(testAgentId, "knowledge", content1); // Duplicate
      await memoryManager.remember(testAgentId, "knowledge", content2);
    });

    it("should compact memory and remove duplicates", async () => {
      const beforeStats = memoryManager.getMemoryStats();
      assertEquals(beforeStats.totalEntries, 3);

      const result = await memoryManager.compactMemory();

      assertEquals(result.removedEntries, 1); // One duplicate removed
      assertEquals(result.recoveredSpace > 0, true);

      const afterStats = memoryManager.getMemoryStats();
      assertEquals(afterStats.totalEntries, 2);
    });

    it("should validate memory integrity", async () => {
      const report = await memoryManager.validateMemoryIntegrity();

      assertExists(report);
      assertEquals(report.totalEntries, 3);
      assertEquals(report.validEntries, 3);
      assertEquals(report.corruptedEntries.length, 0);
      assertEquals(report.inconsistencies.length, 0);
    });

    it("should clear agent memory", async () => {
      await memoryManager.clearMemory(testAgentId);

      const entries = await memoryManager.recall({ agentId: testAgentId });
      assertEquals(entries.length, 0);
    });

    it("should clear all memory", async () => {
      await memoryManager.clearMemory();

      const stats = memoryManager.getMemoryStats();
      assertEquals(stats.totalEntries, 0);
      assertEquals(stats.knowledgeBases, 0);
    });
  });

  describe("Agent Memory Snapshots", () => {
    beforeEach(async () => {
      await memoryManager.remember(testAgentId, "knowledge", { kb: "data" });
      await memoryManager.remember(
        testAgentId,
        "result",
        { result: "success" },
        { shareLevel: "public" },
      );
    });

    it("should provide agent memory snapshots", async () => {
      const snapshot = await memoryManager.getAgentMemorySnapshot(testAgentId);

      assertEquals(snapshot.totalEntries, 2);
      assertEquals(snapshot.recentEntries.length, 2);
      assertEquals(snapshot.knowledgeContributions, 1);
      assertEquals(snapshot.sharedEntries, 1); // Only the public one
    });

    it("should handle empty agent snapshots", async () => {
      const snapshot =
        await memoryManager.getAgentMemorySnapshot("non-existent-agent");

      assertEquals(snapshot.totalEntries, 0);
      assertEquals(snapshot.recentEntries.length, 0);
      assertEquals(snapshot.knowledgeContributions, 0);
      assertEquals(snapshot.sharedEntries, 0);
    });
  });

  describe("Memory Statistics", () => {
    beforeEach(async () => {
      await memoryManager.remember(testAgentId, "knowledge", { data: "test" });
      await memoryManager.remember(testAgentId, "result", { outcome: "pass" });
      await memoryManager.remember("other-agent", "error", { error: "failed" });
    });

    it("should provide comprehensive memory statistics", async () => {
      const stats = memoryManager.getMemoryStats();

      assertEquals(stats.totalEntries, 3);
      assertEquals(stats.entriesByType["knowledge"], 1);
      assertEquals(stats.entriesByType["result"], 1);
      assertEquals(stats.entriesByType["error"], 1);
      assertEquals(stats.entriesByAgent[testAgentId], 2);
      assertEquals(stats.entriesByAgent["other-agent"], 1);
      assertEquals(stats.memoryUsage > 0, true);
    });
  });
});
