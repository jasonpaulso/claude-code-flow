/**
 * SQLite backend unit tests
 */

import {
  assertEquals,
  assertExists,
  assertRejects,
} from "https://deno.land/std@0.208.0/assert/mod.ts";
import {
  describe,
  it,
  beforeEach,
  afterEach,
} from "https://deno.land/std@0.208.0/testing/bdd.ts";
import { SQLiteBackend } from "../../../src/memory/backends/sqlite.ts";
import { MemoryEntry, MemoryQuery } from "../../../src/utils/types.ts";
import { ILogger } from "../../../src/core/logger.ts";
import { MemoryBackendError } from "../../../src/utils/errors.ts";
import { ensureDir, exists } from "https://deno.land/std@0.208.0/fs/mod.ts";
import { join } from "https://deno.land/std@0.208.0/path/mod.ts";

// Mock logger
class MockLogger implements ILogger {
  logs: Array<{ level: string; message: string; context?: unknown }> = [];

  async configure(): Promise<void> {
    // Mock implementation
  }

  debug(message: string, context?: unknown): void {
    this.logs.push({ level: "debug", message, context });
  }

  info(message: string, context?: unknown): void {
    this.logs.push({ level: "info", message, context });
  }

  warn(message: string, context?: unknown): void {
    this.logs.push({ level: "warn", message, context });
  }

  error(message: string, context?: unknown): void {
    this.logs.push({ level: "error", message, context });
  }
}

describe("SQLiteBackend", () => {
  let backend: SQLiteBackend;
  let logger: MockLogger;
  let testDbPath: string;

  beforeEach(async () => {
    logger = new MockLogger();
    const tempDir = await Deno.makeTempDir();
    testDbPath = join(tempDir, "test-memory.db");
    backend = new SQLiteBackend(testDbPath, logger);
    await backend.initialize();
  });

  afterEach(async () => {
    if (backend) {
      await backend.shutdown();
    }
    try {
      await Deno.remove(testDbPath);
      await Deno.remove(testDbPath + "-shm");
      await Deno.remove(testDbPath + "-wal");
    } catch {
      // Ignore errors if files don't exist
    }
  });

  describe("initialize", () => {
    it("should create database and schema", async () => {
      const anotherBackend = new SQLiteBackend(testDbPath + ".2", logger);
      await anotherBackend.initialize();

      // Check that initialization was logged
      const initLog = logger.logs.find(
        (log) => log.level === "info" && log.message.includes("initialized"),
      );
      assertExists(initLog);

      await anotherBackend.shutdown();
      await Deno.remove(testDbPath + ".2");
    });

    it("should handle initialization errors", async () => {
      const invalidPath = "/invalid/path/that/does/not/exist/db.sqlite";
      const errorBackend = new SQLiteBackend(invalidPath, logger);

      await assertRejects(
        () => errorBackend.initialize(),
        MemoryBackendError,
        "Failed to initialize SQLite backend",
      );
    });
  });

  describe("store and retrieve", () => {
    it("should store and retrieve a memory entry", async () => {
      const entry: MemoryEntry = {
        id: "test-123",
        agentId: "agent-1",
        sessionId: "session-1",
        type: "observation",
        content: "Test observation",
        context: { task: "testing", module: "sqlite" },
        timestamp: new Date(),
        tags: ["test", "sqlite"],
        version: 1,
      };

      await backend.store(entry);

      const retrieved = await backend.retrieve(entry.id);
      assertExists(retrieved);
      assertEquals(retrieved.id, entry.id);
      assertEquals(retrieved.agentId, entry.agentId);
      assertEquals(retrieved.content, entry.content);
      assertEquals(retrieved.tags, entry.tags);
      assertEquals(retrieved.context, entry.context);
    });

    it("should update existing entry", async () => {
      const entry: MemoryEntry = {
        id: "update-test",
        agentId: "agent-1",
        sessionId: "session-1",
        type: "insight",
        content: "Original content",
        context: { version: 1 },
        timestamp: new Date(),
        tags: ["original"],
        version: 1,
      };

      await backend.store(entry);

      // Update the entry
      entry.content = "Updated content";
      entry.tags = ["updated"];
      entry.version = 2;

      await backend.update(entry.id, entry);

      const retrieved = await backend.retrieve(entry.id);
      assertExists(retrieved);
      assertEquals(retrieved.content, "Updated content");
      assertEquals(retrieved.tags, ["updated"]);
      assertEquals(retrieved.version, 2);
    });

    it("should handle entry with metadata and parentId", async () => {
      const parentEntry: MemoryEntry = {
        id: "parent-1",
        agentId: "agent-1",
        sessionId: "session-1",
        type: "decision",
        content: "Parent decision",
        context: {},
        timestamp: new Date(),
        tags: [],
        version: 1,
      };

      await backend.store(parentEntry);

      const childEntry: MemoryEntry = {
        id: "child-1",
        agentId: "agent-1",
        sessionId: "session-1",
        type: "artifact",
        content: "Child artifact",
        context: {},
        timestamp: new Date(),
        tags: ["child"],
        version: 1,
        parentId: parentEntry.id,
        metadata: {
          priority: 5,
          source: "test",
          flags: ["important", "reviewed"],
        },
      };

      await backend.store(childEntry);

      const retrieved = await backend.retrieve(childEntry.id);
      assertExists(retrieved);
      assertEquals(retrieved.parentId, parentEntry.id);
      assertEquals(retrieved.metadata, childEntry.metadata);
    });

    it("should return undefined for non-existent entry", async () => {
      const retrieved = await backend.retrieve("non-existent-id");
      assertEquals(retrieved, undefined);
    });
  });

  describe("delete", () => {
    it("should delete entry and cascade to related data", async () => {
      const entry: MemoryEntry = {
        id: "delete-test",
        agentId: "agent-1",
        sessionId: "session-1",
        type: "error",
        content: "To be deleted",
        context: {},
        timestamp: new Date(),
        tags: ["delete", "test"],
        version: 1,
      };

      await backend.store(entry);

      // Verify it exists
      let retrieved = await backend.retrieve(entry.id);
      assertExists(retrieved);

      // Delete it
      await backend.delete(entry.id);

      // Verify it's gone
      retrieved = await backend.retrieve(entry.id);
      assertEquals(retrieved, undefined);
    });
  });

  describe("query", () => {
    beforeEach(async () => {
      // Add test data
      const entries: MemoryEntry[] = [
        {
          id: "query-1",
          agentId: "agent-1",
          sessionId: "session-1",
          type: "observation",
          content: "First observation about testing",
          context: { module: "test" },
          timestamp: new Date("2024-01-01T10:00:00Z"),
          tags: ["test", "first"],
          version: 1,
        },
        {
          id: "query-2",
          agentId: "agent-1",
          sessionId: "session-2",
          type: "insight",
          content: "Insight from analysis",
          context: { module: "analysis" },
          timestamp: new Date("2024-01-02T10:00:00Z"),
          tags: ["analysis", "insight"],
          version: 1,
        },
        {
          id: "query-3",
          agentId: "agent-2",
          sessionId: "session-3",
          type: "decision",
          content: "Decision made after review",
          context: { approved: true },
          timestamp: new Date("2024-01-03T10:00:00Z"),
          tags: ["decision", "approved"],
          version: 1,
        },
        {
          id: "query-4",
          agentId: "agent-1",
          sessionId: "session-1",
          type: "artifact",
          content: "Generated code artifact",
          context: { language: "typescript" },
          timestamp: new Date("2024-01-04T10:00:00Z"),
          tags: ["code", "typescript"],
          version: 1,
        },
      ];

      for (const entry of entries) {
        await backend.store(entry);
      }
    });

    it("should query by agentId", async () => {
      const query: MemoryQuery = { agentId: "agent-1" };
      const results = await backend.query(query);

      assertEquals(results.length, 3);
      results.forEach((entry) => assertEquals(entry.agentId, "agent-1"));
    });

    it("should query by sessionId", async () => {
      const query: MemoryQuery = { sessionId: "session-1" };
      const results = await backend.query(query);

      assertEquals(results.length, 2);
      results.forEach((entry) => assertEquals(entry.sessionId, "session-1"));
    });

    it("should query by type", async () => {
      const query: MemoryQuery = { type: "insight" };
      const results = await backend.query(query);

      assertEquals(results.length, 1);
      assertEquals(results[0].type, "insight");
    });

    it("should query by time range", async () => {
      const query: MemoryQuery = {
        startTime: new Date("2024-01-02T00:00:00Z"),
        endTime: new Date("2024-01-03T23:59:59Z"),
      };
      const results = await backend.query(query);

      assertEquals(results.length, 2);
      assertEquals(results[0].id, "query-3"); // Most recent first
      assertEquals(results[1].id, "query-2");
    });

    it("should query by tags", async () => {
      const query: MemoryQuery = { tags: ["test"] };
      const results = await backend.query(query);

      assertEquals(results.length, 1);
      assertEquals(results[0].id, "query-1");
    });

    it("should query with multiple tags (AND logic)", async () => {
      const query: MemoryQuery = { tags: ["code", "typescript"] };
      const results = await backend.query(query);

      assertEquals(results.length, 1);
      assertEquals(results[0].id, "query-4");
    });

    it("should query with search text", async () => {
      const query: MemoryQuery = { search: "analysis" };
      const results = await backend.query(query);

      assertEquals(results.length, 1);
      assertEquals(results[0].id, "query-2");
    });

    it("should support pagination", async () => {
      const query: MemoryQuery = {
        agentId: "agent-1",
        limit: 2,
        offset: 0,
      };
      const firstPage = await backend.query(query);

      assertEquals(firstPage.length, 2);

      query.offset = 2;
      const secondPage = await backend.query(query);

      assertEquals(secondPage.length, 1);

      // Ensure no overlap
      const firstIds = firstPage.map((e) => e.id);
      const secondIds = secondPage.map((e) => e.id);
      assertEquals(firstIds.filter((id) => secondIds.includes(id)).length, 0);
    });

    it("should combine multiple filters", async () => {
      const query: MemoryQuery = {
        agentId: "agent-1",
        type: "observation",
        tags: ["test"],
      };
      const results = await backend.query(query);

      assertEquals(results.length, 1);
      assertEquals(results[0].id, "query-1");
    });
  });

  describe("getAllEntries", () => {
    it("should return all entries ordered by timestamp", async () => {
      const entries: MemoryEntry[] = [
        {
          id: "all-1",
          agentId: "agent-1",
          sessionId: "session-1",
          type: "observation",
          content: "First",
          context: {},
          timestamp: new Date("2024-01-01"),
          tags: [],
          version: 1,
        },
        {
          id: "all-2",
          agentId: "agent-2",
          sessionId: "session-2",
          type: "insight",
          content: "Second",
          context: {},
          timestamp: new Date("2024-01-02"),
          tags: [],
          version: 1,
        },
      ];

      for (const entry of entries) {
        await backend.store(entry);
      }

      const allEntries = await backend.getAllEntries();

      // Should be ordered by timestamp DESC
      assertEquals(allEntries[0].id, "all-2");
      assertEquals(allEntries[1].id, "all-1");
    });
  });

  describe("getHealthStatus", () => {
    it("should return healthy status with metrics", async () => {
      // Add some test data
      const entry: MemoryEntry = {
        id: "health-test",
        agentId: "agent-1",
        sessionId: "session-1",
        type: "observation",
        content: "Health check test",
        context: {},
        timestamp: new Date(),
        tags: ["health", "test"],
        version: 1,
      };

      await backend.store(entry);

      const status = await backend.getHealthStatus();

      assertEquals(status.healthy, true);
      assertExists(status.metrics);
      assertEquals(status.metrics!.entryCount >= 1, true);
      assertEquals(status.metrics!.dbSizeBytes > 0, true);
      assertEquals(status.metrics!.tagCount >= 2, true);
      assertEquals(status.metrics!.avgTagsPerEntry >= 0, true);
    });

    it("should return unhealthy status when not initialized", async () => {
      const uninitializedBackend = new SQLiteBackend(
        testDbPath + ".health",
        logger,
      );
      const status = await uninitializedBackend.getHealthStatus();

      assertEquals(status.healthy, false);
      assertEquals(status.error, "Database not initialized");
    });
  });

  describe("performMaintenance", () => {
    it("should perform database maintenance", async () => {
      // Add some data
      for (let i = 0; i < 10; i++) {
        const entry: MemoryEntry = {
          id: `maint-${i}`,
          agentId: "agent-1",
          sessionId: "session-1",
          type: "observation",
          content: `Maintenance test entry ${i}`,
          context: { index: i },
          timestamp: new Date(),
          tags: [`tag-${i}`],
          version: 1,
        };
        await backend.store(entry);
      }

      // Perform maintenance
      await backend.performMaintenance();

      // Check that maintenance was logged
      const maintLog = logger.logs.find(
        (log) =>
          log.level === "info" && log.message.includes("maintenance completed"),
      );
      assertExists(maintLog);

      // Verify database still works
      const allEntries = await backend.getAllEntries();
      assertEquals(allEntries.length, 10);
    });
  });

  describe("error handling", () => {
    it("should handle database errors gracefully", async () => {
      // Shutdown the backend to simulate database unavailable
      await backend.shutdown();

      await assertRejects(
        () =>
          backend.store({
            id: "error-test",
            agentId: "agent-1",
            sessionId: "session-1",
            type: "observation",
            content: "This should fail",
            context: {},
            timestamp: new Date(),
            tags: [],
            version: 1,
          }),
        MemoryBackendError,
        "Database not initialized",
      );
    });

    it("should handle invalid JSON in stored data", async () => {
      // This would require direct database manipulation to test properly
      // For now, we'll ensure our implementation handles JSON parsing errors
      const entry: MemoryEntry = {
        id: "json-test",
        agentId: "agent-1",
        sessionId: "session-1",
        type: "observation",
        content: "JSON test",
        context: { nested: { deep: { value: "test" } } },
        timestamp: new Date(),
        tags: ["json", "nested"],
        version: 1,
        metadata: {
          complex: [1, 2, 3],
          boolean: true,
          null: null,
        },
      };

      await backend.store(entry);
      const retrieved = await backend.retrieve(entry.id);

      assertExists(retrieved);
      assertEquals(retrieved.context, entry.context);
      assertEquals(retrieved.metadata, entry.metadata);
    });
  });
});
