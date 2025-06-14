import { EventEmitter } from "node:events";
import { createHash } from "node:crypto";
import { Logger } from "../core/logger.ts";
import { MemoryManager } from "./manager.ts";
import { generateId } from "../utils/helpers.ts";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { EventBus } from "../core/event-bus.ts";
import type { IEventBus } from "../core/event-bus.ts";
import type { ILogger } from "../core/logger.ts";
import { MemoryError, ErrorRecovery } from "../utils/error-types.ts";

export interface SwarmMemoryEntry {
  id: string;
  agentId: string;
  type: "knowledge" | "result" | "state" | "communication" | "error";
  content: any;
  timestamp: Date;
  metadata: {
    taskId?: string;
    objectiveId?: string;
    tags?: string[];
    priority?: number;
    shareLevel?: "private" | "team" | "public";
    checksum?: string;
    version?: number;
    sourceAgent?: string;
  };
}

export interface SwarmMemoryQuery {
  agentId?: string;
  type?: SwarmMemoryEntry["type"];
  taskId?: string;
  objectiveId?: string;
  tags?: string[];
  since?: Date;
  before?: Date;
  limit?: number;
  shareLevel?: SwarmMemoryEntry["metadata"]["shareLevel"];
}

export interface SwarmKnowledgeBase {
  id: string;
  name: string;
  description: string;
  entries: SwarmMemoryEntry[];
  metadata: {
    domain: string;
    expertise: string[];
    contributors: string[];
    lastUpdated: Date;
  };
}

export interface SwarmMemoryConfig {
  namespace: string;
  enableDistribution: boolean;
  enableReplication: boolean;
  syncInterval: number;
  maxEntries: number;
  compressionThreshold: number;
  enableKnowledgeBase: boolean;
  enableCrossAgentSharing: boolean;
  persistencePath: string;
}

export class SwarmMemoryManager extends EventEmitter {
  private logger: ILogger;
  private config: SwarmMemoryConfig;
  private baseMemory: MemoryManager;
  private entries: Map<string, SwarmMemoryEntry>;
  private knowledgeBases: Map<string, SwarmKnowledgeBase>;
  private agentMemories: Map<string, Set<string>>; // agentId -> set of entry IDs
  private syncTimer?: number;
  private isInitialized: boolean = false;
  private eventBus: IEventBus;

  constructor(config: Partial<SwarmMemoryConfig> = {}) {
    super();
    this.logger = new Logger(
      { level: "info", format: "json", destination: "console" },
      { component: "SwarmMemoryManager" },
    );
    this.eventBus = EventBus.getInstance();
    this.config = {
      namespace: "swarm",
      enableDistribution: true,
      enableReplication: true,
      syncInterval: 10000, // 10 seconds
      maxEntries: 10000,
      compressionThreshold: 1000,
      enableKnowledgeBase: true,
      enableCrossAgentSharing: true,
      persistencePath: "./swarm-memory",
      ...config,
    };

    this.entries = new Map();
    this.knowledgeBases = new Map();
    this.agentMemories = new Map();

    this.baseMemory = new MemoryManager(
      {
        backend: "markdown",
        cacheSizeMB: 100,
        syncInterval: 30000,
        conflictResolution: "last-write",
        retentionDays: 30,
        markdownDir: path.join(this.config.persistencePath, "entries"),
      },
      this.eventBus,
      this.logger,
    );
  }

  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    this.logger.info("Initializing swarm memory manager...");

    // Initialize base memory
    await this.baseMemory.initialize();

    // Create persistence directory
    await fs.mkdir(this.config.persistencePath, { recursive: true });

    // Load existing memory
    await this.loadMemoryState();

    // Start sync timer
    if (this.config.syncInterval > 0) {
      this.syncTimer = setInterval(() => {
        this.syncMemoryState();
      }, this.config.syncInterval);
    }

    this.isInitialized = true;
    this.emit("memory:initialized");
  }

  async shutdown(): Promise<void> {
    if (!this.isInitialized) return;

    this.logger.info("Shutting down swarm memory manager...");

    // Stop sync timer
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = undefined;
    }

    // Save final state
    await this.saveMemoryState();

    this.isInitialized = false;
    this.emit("memory:shutdown");
  }

  async remember(
    agentId: string,
    type: SwarmMemoryEntry["type"],
    content: any,
    metadata: Partial<SwarmMemoryEntry["metadata"]> = {},
  ): Promise<string> {
    // Validate input data
    this.validateMemoryEntry(agentId, type, content, metadata);

    const entryId = generateId("mem");
    const entry: SwarmMemoryEntry = {
      id: entryId,
      agentId,
      type,
      content,
      timestamp: new Date(),
      metadata: {
        shareLevel: "team",
        priority: 1,
        version: 1,
        checksum: this.generateChecksum(content),
        ...metadata,
      },
    };

    this.entries.set(entryId, entry);

    // Associate with agent
    if (!this.agentMemories.has(agentId)) {
      this.agentMemories.set(agentId, new Set());
    }
    this.agentMemories.get(agentId)!.add(entryId);

    // Store in base memory for persistence
    await this.baseMemory.store({
      id: entryId,
      agentId: agentId,
      sessionId: this.config.namespace,
      type:
        type === "observation" ||
        type === "action" ||
        type === "result" ||
        type === "knowledge"
          ? "observation"
          : "observation",
      content: JSON.stringify(entry),
      context: {
        entryType: type,
        shareLevel: entry.metadata.shareLevel,
      },
      timestamp: entry.timestamp,
      tags: entry.tags,
      version: 1,
    });

    this.logger.debug(`Agent ${agentId} remembered: ${type} - ${entryId}`);
    this.emit("memory:added", entry);

    // Update knowledge base if applicable
    if (type === "knowledge" && this.config.enableKnowledgeBase) {
      await this.updateKnowledgeBase(entry);
    }

    // Check for memory limits
    await this.enforceMemoryLimits();

    return entryId;
  }

  async recall(query: SwarmMemoryQuery): Promise<SwarmMemoryEntry[]> {
    let results = Array.from(this.entries.values());

    // Apply filters
    if (query.agentId) {
      results = results.filter((e) => e.agentId === query.agentId);
    }

    if (query.type) {
      results = results.filter((e) => e.type === query.type);
    }

    if (query.taskId) {
      results = results.filter((e) => e.metadata.taskId === query.taskId);
    }

    if (query.objectiveId) {
      results = results.filter(
        (e) => e.metadata.objectiveId === query.objectiveId,
      );
    }

    if (query.tags && query.tags.length > 0) {
      results = results.filter(
        (e) =>
          e.metadata.tags &&
          query.tags!.some((tag) => e.metadata.tags!.includes(tag)),
      );
    }

    if (query.since) {
      results = results.filter((e) => e.timestamp >= query.since!);
    }

    if (query.before) {
      results = results.filter((e) => e.timestamp <= query.before!);
    }

    if (query.shareLevel) {
      results = results.filter(
        (e) => e.metadata.shareLevel === query.shareLevel,
      );
    }

    // Sort by timestamp (newest first)
    results.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

    // Apply limit
    if (query.limit) {
      results = results.slice(0, query.limit);
    }

    this.logger.debug(`Recalled ${results.length} memories for query`);
    return results;
  }

  async shareMemory(entryId: string, targetAgentId: string): Promise<void> {
    const entry = this.entries.get(entryId);
    if (!entry) {
      throw new Error("Memory entry not found");
    }

    if (!this.config.enableCrossAgentSharing) {
      throw new Error("Cross-agent sharing is disabled");
    }

    // Check share level permissions
    if (entry.metadata.shareLevel === "private") {
      throw new Error("Memory entry is private and cannot be shared");
    }

    // Create a shared copy for the target agent
    const sharedEntry: SwarmMemoryEntry = {
      ...entry,
      id: generateId("mem"),
      metadata: {
        ...entry.metadata,
        originalId: entryId,
        sharedFrom: entry.agentId,
        sharedTo: targetAgentId,
        sharedAt: new Date(),
      },
    };

    this.entries.set(sharedEntry.id, sharedEntry);

    // Associate with target agent
    if (!this.agentMemories.has(targetAgentId)) {
      this.agentMemories.set(targetAgentId, new Set());
    }
    this.agentMemories.get(targetAgentId)!.add(sharedEntry.id);

    this.logger.info(
      `Shared memory ${entryId} from ${entry.agentId} to ${targetAgentId}`,
    );
    this.emit("memory:shared", { original: entry, shared: sharedEntry });
  }

  async broadcastMemory(entryId: string, agentIds?: string[]): Promise<void> {
    const entry = this.entries.get(entryId);
    if (!entry) {
      throw new Error("Memory entry not found");
    }

    if (entry.metadata.shareLevel === "private") {
      throw new Error("Cannot broadcast private memory");
    }

    const targets =
      agentIds ||
      Array.from(this.agentMemories.keys()).filter(
        (id) => id !== entry.agentId,
      );

    for (const targetId of targets) {
      try {
        await this.shareMemory(entryId, targetId);
      } catch (error) {
        this.logger.warn(`Failed to share memory to ${targetId}:`, error);
      }
    }

    this.logger.info(
      `Broadcasted memory ${entryId} to ${targets.length} agents`,
    );
  }

  async createKnowledgeBase(
    name: string,
    description: string,
    domain: string,
    expertise: string[],
  ): Promise<string> {
    const kbId = generateId("kb");
    const knowledgeBase: SwarmKnowledgeBase = {
      id: kbId,
      name,
      description,
      entries: [],
      metadata: {
        domain,
        expertise,
        contributors: [],
        lastUpdated: new Date(),
      },
    };

    this.knowledgeBases.set(kbId, knowledgeBase);

    this.logger.info(`Created knowledge base: ${name} (${kbId})`);
    this.emit("knowledgebase:created", knowledgeBase);

    return kbId;
  }

  async updateKnowledgeBase(entry: SwarmMemoryEntry): Promise<void> {
    if (!this.config.enableKnowledgeBase) return;

    // Find relevant knowledge bases
    const relevantKBs = Array.from(this.knowledgeBases.values()).filter(
      (kb) => {
        // Simple matching based on tags and content
        const tags = entry.metadata.tags || [];
        return tags.some((tag) =>
          kb.metadata.expertise.some(
            (exp) =>
              exp.toLowerCase().includes(tag.toLowerCase()) ||
              tag.toLowerCase().includes(exp.toLowerCase()),
          ),
        );
      },
    );

    for (const kb of relevantKBs) {
      // Add entry to knowledge base
      kb.entries.push(entry);
      kb.metadata.lastUpdated = new Date();

      // Add contributor
      if (!kb.metadata.contributors.includes(entry.agentId)) {
        kb.metadata.contributors.push(entry.agentId);
      }

      this.logger.debug(
        `Updated knowledge base ${kb.id} with entry ${entry.id}`,
      );
    }
  }

  async searchKnowledge(
    query: string,
    domain?: string,
    expertise?: string[],
  ): Promise<SwarmMemoryEntry[]> {
    const allEntries: SwarmMemoryEntry[] = [];

    // Search in knowledge bases
    for (const kb of this.knowledgeBases.values()) {
      if (domain && kb.metadata.domain !== domain) continue;

      if (
        expertise &&
        !expertise.some((exp) => kb.metadata.expertise.includes(exp))
      ) {
        continue;
      }

      allEntries.push(...kb.entries);
    }

    // Simple text search (in real implementation, use better search)
    const queryLower = query.toLowerCase();
    const results = allEntries.filter((entry) => {
      const contentStr = JSON.stringify(entry.content).toLowerCase();
      return contentStr.includes(queryLower);
    });

    return results.slice(0, 50); // Limit results
  }

  async getAgentMemorySnapshot(agentId: string): Promise<{
    totalEntries: number;
    recentEntries: SwarmMemoryEntry[];
    knowledgeContributions: number;
    sharedEntries: number;
  }> {
    const agentEntryIds = this.agentMemories.get(agentId) || new Set();
    const agentEntries = Array.from(agentEntryIds)
      .map((id) => this.entries.get(id))
      .filter(Boolean) as SwarmMemoryEntry[];

    const recentEntries = agentEntries
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
      .slice(0, 10);

    const knowledgeContributions = agentEntries.filter(
      (e) => e.type === "knowledge",
    ).length;

    const sharedEntries = agentEntries.filter(
      (e) =>
        e.metadata.shareLevel === "public" || e.metadata.shareLevel === "team",
    ).length;

    return {
      totalEntries: agentEntries.length,
      recentEntries,
      knowledgeContributions,
      sharedEntries,
    };
  }

  private async loadMemoryState(): Promise<void> {
    try {
      // Load entries
      const entriesFile = path.join(
        this.config.persistencePath,
        "entries.json",
      );
      try {
        const entriesData = await fs.readFile(entriesFile, "utf-8");
        const entriesArray = JSON.parse(entriesData);

        for (const entry of entriesArray) {
          this.entries.set(entry.id, {
            ...entry,
            timestamp: new Date(entry.timestamp),
          });

          // Rebuild agent memory associations
          if (!this.agentMemories.has(entry.agentId)) {
            this.agentMemories.set(entry.agentId, new Set());
          }
          this.agentMemories.get(entry.agentId)!.add(entry.id);
        }

        this.logger.info(`Loaded ${entriesArray.length} memory entries`);
      } catch (error) {
        this.logger.warn("No existing memory entries found");
      }

      // Load knowledge bases
      const kbFile = path.join(
        this.config.persistencePath,
        "knowledge-bases.json",
      );
      try {
        const kbData = await fs.readFile(kbFile, "utf-8");
        const kbArray = JSON.parse(kbData);

        for (const kb of kbArray) {
          this.knowledgeBases.set(kb.id, {
            ...kb,
            metadata: {
              ...kb.metadata,
              lastUpdated: new Date(kb.metadata.lastUpdated),
            },
            entries: kb.entries.map((e: any) => ({
              ...e,
              timestamp: new Date(e.timestamp),
            })),
          });
        }

        this.logger.info(`Loaded ${kbArray.length} knowledge bases`);
      } catch (error) {
        this.logger.warn("No existing knowledge bases found");
      }
    } catch (error) {
      this.logger.error("Error loading memory state:", error);
    }
  }

  private async saveMemoryState(): Promise<void> {
    try {
      // Ensure persistence directory exists
      await fs.mkdir(this.config.persistencePath, { recursive: true });

      // Save entries with retry logic
      await ErrorRecovery.retryOperation(
        async () => {
          const entriesArray = Array.from(this.entries.values());
          const entriesFile = path.join(
            this.config.persistencePath,
            "entries.json",
          );
          await fs.writeFile(
            entriesFile,
            JSON.stringify(entriesArray, null, 2),
          );
        },
        {
          maxAttempts: 3,
          backoffMs: 1000,
          operation: "save memory entries",
        },
      );

      // Save knowledge bases with retry logic
      await ErrorRecovery.retryOperation(
        async () => {
          const kbArray = Array.from(this.knowledgeBases.values());
          const kbFile = path.join(
            this.config.persistencePath,
            "knowledge-bases.json",
          );
          await fs.writeFile(kbFile, JSON.stringify(kbArray, null, 2));
        },
        {
          maxAttempts: 3,
          backoffMs: 1000,
          operation: "save knowledge bases",
        },
      );

      this.logger.debug("Saved memory state to disk");
    } catch (error) {
      const memoryError = new MemoryError(
        "Failed to save memory state to disk",
        {
          originalError: error as Error,
          userMessage:
            "Unable to save swarm memory. Some information may be lost if the system restarts.",
          recoverable: true,
          retryable: true,
          metadata: {
            persistencePath: this.config.persistencePath,
            entriesCount: this.entries.size,
            knowledgeBasesCount: this.knowledgeBases.size,
          },
        },
      );

      this.logger.error("Memory state save failed", {
        error: memoryError.toJSON(),
      });

      // Emit warning but don't fail the operation
      this.emit("memory:save-warning", {
        error: memoryError,
        userMessage: memoryError.userMessage,
      });
    }
  }

  private async syncMemoryState(): Promise<void> {
    try {
      await this.saveMemoryState();
      this.emit("memory:synced");
    } catch (error) {
      this.logger.error("Error syncing memory state:", error);
    }
  }

  private async enforceMemoryLimits(): Promise<void> {
    if (this.entries.size <= this.config.maxEntries) return;

    this.logger.info("Enforcing memory limits...");

    // Remove oldest entries that are not marked as important
    const entries = Array.from(this.entries.values())
      .filter((e) => (e.metadata.priority || 1) <= 1) // Only remove low priority
      .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

    const toRemove = entries.slice(
      0,
      this.entries.size - this.config.maxEntries,
    );

    for (const entry of toRemove) {
      this.entries.delete(entry.id);

      // Remove from agent memory
      const agentEntries = this.agentMemories.get(entry.agentId);
      if (agentEntries) {
        agentEntries.delete(entry.id);
      }

      this.logger.debug(`Removed old memory entry: ${entry.id}`);
    }

    this.emit("memory:cleaned", toRemove.length);
  }

  // Public API methods
  getMemoryStats(): {
    totalEntries: number;
    entriesByType: Record<string, number>;
    entriesByAgent: Record<string, number>;
    knowledgeBases: number;
    memoryUsage: number;
  } {
    const entries = Array.from(this.entries.values());
    const entriesByType: Record<string, number> = {};
    const entriesByAgent: Record<string, number> = {};

    for (const entry of entries) {
      entriesByType[entry.type] = (entriesByType[entry.type] || 0) + 1;
      entriesByAgent[entry.agentId] = (entriesByAgent[entry.agentId] || 0) + 1;
    }

    // Rough memory usage calculation
    const memoryUsage = JSON.stringify(entries).length;

    return {
      totalEntries: entries.length,
      entriesByType,
      entriesByAgent,
      knowledgeBases: this.knowledgeBases.size,
      memoryUsage,
    };
  }

  async exportMemory(agentId?: string): Promise<any> {
    const entries = agentId
      ? await this.recall({ agentId })
      : Array.from(this.entries.values());

    return {
      entries,
      knowledgeBases: agentId
        ? Array.from(this.knowledgeBases.values()).filter((kb) =>
            kb.metadata.contributors.includes(agentId),
          )
        : Array.from(this.knowledgeBases.values()),
      exportedAt: new Date(),
      stats: this.getMemoryStats(),
    };
  }

  async clearMemory(agentId?: string): Promise<void> {
    if (agentId) {
      // Clear specific agent's memory
      const entryIds = this.agentMemories.get(agentId) || new Set();
      for (const entryId of entryIds) {
        this.entries.delete(entryId);
      }
      this.agentMemories.delete(agentId);
      this.logger.info(`Cleared memory for agent ${agentId}`);
    } else {
      // Clear all memory
      this.entries.clear();
      this.agentMemories.clear();
      this.knowledgeBases.clear();
      this.logger.info("Cleared all swarm memory");
    }

    this.emit("memory:cleared", { agentId });
  }

  async importMemory(data: any): Promise<{
    imported: number;
    failed: number;
    errors: string[];
  }> {
    let imported = 0;
    let failed = 0;
    const errors: string[] = [];

    try {
      // Validate import data structure
      if (!data.entries || !Array.isArray(data.entries)) {
        throw new Error(
          "Invalid import data: missing or invalid entries array",
        );
      }

      this.logger.info(
        `Starting memory import of ${data.entries.length} entries...`,
      );

      for (const entryData of data.entries) {
        try {
          // Validate and sanitize entry
          const entry = this.validateAndSanitizeImportEntry(entryData);

          // Check for conflicts
          if (this.entries.has(entry.id)) {
            // Handle conflict - create new ID or merge
            entry.id = generateId("mem");
            entry.metadata.version = (entry.metadata.version || 1) + 1;
          }

          // Verify checksum if present
          if (entry.metadata.checksum) {
            const calculatedChecksum = this.generateChecksum(entry.content);
            if (calculatedChecksum !== entry.metadata.checksum) {
              errors.push(`Checksum mismatch for entry ${entry.id}`);
              entry.metadata.checksum = calculatedChecksum;
            }
          }

          // Store entry
          this.entries.set(entry.id, entry);

          // Update agent memory associations
          if (!this.agentMemories.has(entry.agentId)) {
            this.agentMemories.set(entry.agentId, new Set());
          }
          this.agentMemories.get(entry.agentId)!.add(entry.id);

          imported++;
        } catch (error) {
          failed++;
          errors.push(`Failed to import entry: ${error.message}`);
          this.logger.warn("Failed to import memory entry:", error);
        }
      }

      // Import knowledge bases if present
      if (data.knowledgeBases && Array.isArray(data.knowledgeBases)) {
        for (const kbData of data.knowledgeBases) {
          try {
            this.knowledgeBases.set(kbData.id, {
              ...kbData,
              metadata: {
                ...kbData.metadata,
                lastUpdated: new Date(kbData.metadata.lastUpdated),
              },
              entries: kbData.entries.map((e: any) => ({
                ...e,
                timestamp: new Date(e.timestamp),
              })),
            });
          } catch (error) {
            errors.push(
              `Failed to import knowledge base ${kbData.id}: ${error.message}`,
            );
          }
        }
      }

      // Save imported data
      await this.saveMemoryState();

      this.logger.info(
        `Memory import completed: ${imported} imported, ${failed} failed`,
      );
      this.emit("memory:imported", { imported, failed, errors });

      return { imported, failed, errors };
    } catch (error) {
      this.logger.error("Memory import failed:", error);
      throw new MemoryError("Failed to import memory data", {
        originalError: error as Error,
        userMessage:
          "Memory import failed. Please check the data format and try again.",
        recoverable: false,
        retryable: true,
      });
    }
  }

  async compactMemory(): Promise<{
    removedEntries: number;
    recoveredSpace: number;
  }> {
    const before = this.entries.size;
    const beforeSize = JSON.stringify(Array.from(this.entries.values())).length;

    // Remove duplicate entries (same content but different IDs)
    const contentHashes = new Map<string, string>();
    const toRemove = new Set<string>();

    for (const [entryId, entry] of this.entries) {
      const contentHash = this.generateChecksum(entry.content);

      if (contentHashes.has(contentHash)) {
        // Found duplicate - keep the newer one
        const existingId = contentHashes.get(contentHash)!;
        const existingEntry = this.entries.get(existingId);

        if (existingEntry && entry.timestamp > existingEntry.timestamp) {
          // Remove the older entry
          toRemove.add(existingId);
          contentHashes.set(contentHash, entryId);
        } else {
          // Remove the current entry
          toRemove.add(entryId);
        }
      } else {
        contentHashes.set(contentHash, entryId);
      }
    }

    // Remove identified duplicates
    for (const entryId of toRemove) {
      const entry = this.entries.get(entryId);
      if (entry) {
        this.entries.delete(entryId);

        // Remove from agent memory
        const agentEntries = this.agentMemories.get(entry.agentId);
        if (agentEntries) {
          agentEntries.delete(entryId);
        }
      }
    }

    // Remove orphaned agent memory references
    for (const [agentId, entryIds] of this.agentMemories) {
      const validIds = new Set<string>();
      for (const entryId of entryIds) {
        if (this.entries.has(entryId)) {
          validIds.add(entryId);
        }
      }
      this.agentMemories.set(agentId, validIds);
    }

    const after = this.entries.size;
    const afterSize = JSON.stringify(Array.from(this.entries.values())).length;
    const removedEntries = before - after;
    const recoveredSpace = beforeSize - afterSize;

    await this.saveMemoryState();

    this.logger.info(
      `Memory compaction completed: removed ${removedEntries} entries, recovered ${recoveredSpace} bytes`,
    );
    this.emit("memory:compacted", { removedEntries, recoveredSpace });

    return { removedEntries, recoveredSpace };
  }

  async validateMemoryIntegrity(): Promise<{
    totalEntries: number;
    validEntries: number;
    corruptedEntries: string[];
    missingChecksums: string[];
    inconsistencies: string[];
  }> {
    const totalEntries = this.entries.size;
    let validEntries = 0;
    const corruptedEntries: string[] = [];
    const missingChecksums: string[] = [];
    const inconsistencies: string[] = [];

    for (const [entryId, entry] of this.entries) {
      try {
        // Validate entry structure
        this.validateMemoryEntry(
          entry.agentId,
          entry.type,
          entry.content,
          entry.metadata,
        );

        // Check checksum if present
        if (entry.metadata.checksum) {
          const calculatedChecksum = this.generateChecksum(entry.content);
          if (calculatedChecksum !== entry.metadata.checksum) {
            corruptedEntries.push(entryId);
            continue;
          }
        } else {
          missingChecksums.push(entryId);
        }

        // Check agent memory association
        const agentEntries = this.agentMemories.get(entry.agentId);
        if (!agentEntries || !agentEntries.has(entryId)) {
          inconsistencies.push(
            `Entry ${entryId} not associated with agent ${entry.agentId}`,
          );
        }

        validEntries++;
      } catch (error) {
        corruptedEntries.push(entryId);
        this.logger.warn(`Invalid memory entry ${entryId}:`, error);
      }
    }

    const report = {
      totalEntries,
      validEntries,
      corruptedEntries,
      missingChecksums,
      inconsistencies,
    };

    this.logger.info("Memory integrity check completed:", report);
    return report;
  }

  private validateMemoryEntry(
    agentId: string,
    type: SwarmMemoryEntry["type"],
    content: any,
    metadata: Partial<SwarmMemoryEntry["metadata"]> = {},
  ): void {
    // Basic validation
    if (!agentId || typeof agentId !== "string") {
      throw new MemoryError("Invalid agent ID", {
        userMessage: "Agent ID must be a non-empty string",
        recoverable: false,
      });
    }

    if (
      !type ||
      !["knowledge", "result", "state", "communication", "error"].includes(type)
    ) {
      throw new MemoryError("Invalid memory entry type", {
        userMessage:
          "Memory entry type must be one of: knowledge, result, state, communication, error",
        recoverable: false,
      });
    }

    if (content === undefined || content === null) {
      throw new MemoryError("Memory content cannot be null or undefined", {
        userMessage: "Memory entry must have valid content",
        recoverable: false,
      });
    }

    // Validate metadata
    if (
      metadata.priority &&
      (typeof metadata.priority !== "number" ||
        metadata.priority < 1 ||
        metadata.priority > 10)
    ) {
      throw new MemoryError("Invalid priority value", {
        userMessage: "Priority must be a number between 1 and 10",
        recoverable: false,
      });
    }

    if (
      metadata.shareLevel &&
      !["private", "team", "public"].includes(metadata.shareLevel)
    ) {
      throw new MemoryError("Invalid share level", {
        userMessage: "Share level must be one of: private, team, public",
        recoverable: false,
      });
    }

    if (metadata.tags && !Array.isArray(metadata.tags)) {
      throw new MemoryError("Tags must be an array", {
        userMessage: "Tags must be provided as an array of strings",
        recoverable: false,
      });
    }

    // Content size validation (limit to 1MB)
    const contentSize = JSON.stringify(content).length;
    if (contentSize > 1024 * 1024) {
      throw new MemoryError("Memory entry content too large", {
        userMessage: "Memory entry content must be less than 1MB",
        recoverable: false,
      });
    }
  }

  private generateChecksum(content: any): string {
    const contentStr = JSON.stringify(content);
    return createHash("sha256").update(contentStr).digest("hex");
  }

  private validateAndSanitizeImportEntry(entryData: any): SwarmMemoryEntry {
    // Ensure required fields exist
    if (!entryData.id || !entryData.agentId || !entryData.type) {
      throw new Error("Missing required fields: id, agentId, type");
    }

    // Validate and sanitize the entry
    const entry: SwarmMemoryEntry = {
      id: entryData.id,
      agentId: entryData.agentId,
      type: entryData.type,
      content: entryData.content,
      timestamp: new Date(entryData.timestamp || Date.now()),
      metadata: {
        shareLevel: "team",
        priority: 1,
        version: 1,
        ...entryData.metadata,
      },
    };

    // Validate the sanitized entry
    this.validateMemoryEntry(
      entry.agentId,
      entry.type,
      entry.content,
      entry.metadata,
    );

    return entry;
  }
}
