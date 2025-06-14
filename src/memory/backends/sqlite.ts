/**
 * SQLite backend implementation for memory storage
 */

import { IMemoryBackend } from "./base.ts";
import { MemoryEntry, MemoryQuery } from "../../utils/types.ts";
import { ILogger } from "../../core/logger.ts";
import { MemoryBackendError } from "../../utils/errors.ts";
import { Database } from "https://deno.land/x/sqlite3@0.12.0/mod.ts";
import { ensureDir } from "https://deno.land/std@0.208.0/fs/mod.ts";
import { dirname } from "https://deno.land/std@0.208.0/path/mod.ts";

/**
 * SQLite-based memory backend
 */
export class SQLiteBackend implements IMemoryBackend {
  private db?: Database;
  private preparedStatements: Map<string, any> = new Map();

  constructor(
    private dbPath: string,
    private logger: ILogger,
  ) {}

  async initialize(): Promise<void> {
    this.logger.info("Initializing SQLite backend", { dbPath: this.dbPath });

    try {
      // Ensure directory exists
      await ensureDir(dirname(this.dbPath));

      // Open database connection
      this.db = new Database(this.dbPath);

      // Enable foreign keys and WAL mode
      this.db.exec("PRAGMA foreign_keys = ON");
      this.db.exec("PRAGMA journal_mode = WAL");
      this.db.exec("PRAGMA synchronous = NORMAL");
      this.db.exec("PRAGMA cache_size = -64000"); // 64MB cache
      this.db.exec("PRAGMA temp_store = MEMORY");

      // Create tables and indexes
      await this.createSchema();

      // Prepare frequently used statements
      this.prepareStatements();

      this.logger.info("SQLite backend initialized");
    } catch (error) {
      this.logger.error("Failed to initialize SQLite backend", {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        dbPath: this.dbPath,
      });
      throw new MemoryBackendError("Failed to initialize SQLite backend", {
        error,
      });
    }
  }

  async shutdown(): Promise<void> {
    this.logger.info("Shutting down SQLite backend");

    if (this.db) {
      // Close all prepared statements
      for (const stmt of this.preparedStatements.values()) {
        if (stmt && typeof stmt.finalize === "function") {
          stmt.finalize();
        }
      }
      this.preparedStatements.clear();

      // Close database connection
      this.db.close();
      delete this.db;
    }
  }

  async store(entry: MemoryEntry): Promise<void> {
    if (!this.db) {
      throw new MemoryBackendError("Database not initialized");
    }

    try {
      // Use a transaction by wrapping operations in BEGIN/COMMIT
      this.db.exec("BEGIN TRANSACTION");

      try {
        // Insert or update main entry
        const stmt = this.preparedStatements.get("store");
        stmt.run(
          entry.id,
          entry.agentId,
          entry.sessionId,
          entry.type,
          entry.content,
          JSON.stringify(entry.context),
          entry.timestamp.getTime(),
          entry.version,
          entry.parentId || null,
          entry.metadata ? JSON.stringify(entry.metadata) : null,
        );

        // Handle tags
        if (entry.tags && entry.tags.length > 0) {
          // Remove existing tags
          this.db
            .prepare("DELETE FROM memory_entry_tags WHERE memory_entry_id = ?")
            .run(entry.id);

          // Insert new tags
          const tagStmt = this.preparedStatements.get("insertTag");
          const linkStmt = this.preparedStatements.get("linkTag");

          for (const tag of entry.tags) {
            // Insert tag if it doesn't exist
            tagStmt.run(tag);

            // Get tag ID
            const tagRow = this.db
              .prepare("SELECT id FROM tags WHERE name = ?")
              .get(tag) as any;
            if (tagRow) {
              // Link tag to entry
              linkStmt.run(entry.id, tagRow.id);
            }
          }
        }

        // Update full-text search index
        this.db
          .prepare(
            "INSERT OR REPLACE INTO memory_entries_fts (id, content, context) VALUES (?, ?, ?)",
          )
          .run(entry.id, entry.content, JSON.stringify(entry.context));

        this.db.exec("COMMIT");
      } catch (error) {
        this.db.exec("ROLLBACK");
        throw error;
      }
    } catch (error) {
      throw new MemoryBackendError("Failed to store entry", { error });
    }
  }

  async retrieve(id: string): Promise<MemoryEntry | undefined> {
    if (!this.db) {
      throw new MemoryBackendError("Database not initialized");
    }

    try {
      // Get entry with tags
      const stmt = this.db.prepare(
        `SELECT me.*, GROUP_CONCAT(t.name) AS tag_names
         FROM memory_entries me
         LEFT JOIN memory_entry_tags met ON me.id = met.memory_entry_id
         LEFT JOIN tags t ON met.tag_id = t.id
         WHERE me.id = ?
         GROUP BY me.id`,
      );

      const row = stmt.get(id);

      if (!row) {
        return undefined;
      }

      return this.rowToEntry(row);
    } catch (error) {
      throw new MemoryBackendError("Failed to retrieve entry", { error });
    }
  }

  async update(id: string, entry: MemoryEntry): Promise<void> {
    // SQLite INSERT OR REPLACE handles updates
    await this.store(entry);
  }

  async delete(id: string): Promise<void> {
    if (!this.db) {
      throw new MemoryBackendError("Database not initialized");
    }

    try {
      this.db.exec("BEGIN TRANSACTION");

      try {
        // Delete from FTS index
        this.db.prepare("DELETE FROM memory_entries_fts WHERE id = ?").run(id);

        // Delete main entry (cascades to tags and other related tables)
        const stmt = this.preparedStatements.get("delete");
        stmt.run(id);

        this.db.exec("COMMIT");
      } catch (error) {
        this.db.exec("ROLLBACK");
        throw error;
      }
    } catch (error) {
      throw new MemoryBackendError("Failed to delete entry", { error });
    }
  }

  async query(query: MemoryQuery): Promise<MemoryEntry[]> {
    if (!this.db) {
      throw new MemoryBackendError("Database not initialized");
    }

    const conditions: string[] = [];
    const params: unknown[] = [];

    // Build base query with tags
    let sql = `
      SELECT me.*, GROUP_CONCAT(t.name) AS tag_names
      FROM memory_entries me
      LEFT JOIN memory_entry_tags met ON me.id = met.memory_entry_id
      LEFT JOIN tags t ON met.tag_id = t.id
    `;

    if (query.agentId) {
      conditions.push("me.agent_id = ?");
      params.push(query.agentId);
    }

    if (query.sessionId) {
      conditions.push("me.session_id = ?");
      params.push(query.sessionId);
    }

    if (query.type) {
      conditions.push("me.type = ?");
      params.push(query.type);
    }

    if (query.startTime) {
      conditions.push("me.timestamp >= ?");
      params.push(query.startTime.getTime());
    }

    if (query.endTime) {
      conditions.push("me.timestamp <= ?");
      params.push(query.endTime.getTime());
    }

    if (query.search) {
      // Use FTS for search
      conditions.push(`me.id IN (
        SELECT id FROM memory_entries_fts 
        WHERE memory_entries_fts MATCH ?
      )`);
      params.push(query.search);
    }

    if (query.tags && query.tags.length > 0) {
      const tagPlaceholders = query.tags.map(() => "?").join(",");
      conditions.push(`me.id IN (
        SELECT memory_entry_id 
        FROM memory_entry_tags met2
        JOIN tags t2 ON met2.tag_id = t2.id
        WHERE t2.name IN (${tagPlaceholders})
        GROUP BY memory_entry_id
        HAVING COUNT(DISTINCT t2.name) = ?
      )`);
      params.push(...query.tags, query.tags.length);
    }

    if (query.namespace) {
      conditions.push(`me.id IN (
        SELECT memory_entry_id
        FROM memory_entry_namespaces men
        JOIN namespaces n ON men.namespace_id = n.id
        WHERE n.name = ?
      )`);
      params.push(query.namespace);
    }

    if (conditions.length > 0) {
      sql += " WHERE " + conditions.join(" AND ");
    }

    sql += " GROUP BY me.id ORDER BY me.timestamp DESC";

    if (query.limit) {
      sql += " LIMIT ?";
      params.push(query.limit);
    }

    if (query.offset) {
      sql += " OFFSET ?";
      params.push(query.offset);
    }

    try {
      const stmt = this.db.prepare(sql);
      // Cast params to the expected types for sqlite3
      const rows = stmt.all(
        ...(params as Array<string | number | null>),
      ) as any[];
      return rows.map((row) => this.rowToEntry(row));
    } catch (error) {
      throw new MemoryBackendError("Failed to query entries", { error });
    }
  }

  async getAllEntries(): Promise<MemoryEntry[]> {
    if (!this.db) {
      throw new MemoryBackendError("Database not initialized");
    }

    const sql = `
      SELECT me.*, GROUP_CONCAT(t.name) AS tag_names
      FROM memory_entries me
      LEFT JOIN memory_entry_tags met ON me.id = met.memory_entry_id
      LEFT JOIN tags t ON met.tag_id = t.id
      GROUP BY me.id
      ORDER BY me.timestamp DESC
    `;

    try {
      const stmt = this.db.prepare(sql);
      const rows = stmt.all() as any[];
      return rows.map((row) => this.rowToEntry(row));
    } catch (error) {
      throw new MemoryBackendError("Failed to get all entries", { error });
    }
  }

  async getHealthStatus(): Promise<{
    healthy: boolean;
    error?: string;
    metrics?: Record<string, number>;
  }> {
    if (!this.db) {
      return {
        healthy: false,
        error: "Database not initialized",
      };
    }

    try {
      // Check database connectivity
      this.db.prepare("SELECT 1").get();

      // Get metrics
      const entryCountRow = this.db
        .prepare("SELECT COUNT(*) as count FROM memory_entries")
        .get() as any;
      const entryCount = entryCountRow?.count || 0;

      const pageCountRow = this.db.prepare("PRAGMA page_count").get() as any;
      const pageSizeRow = this.db.prepare("PRAGMA page_size").get() as any;
      const pageCount = pageCountRow?.page_count || 0;
      const pageSize = pageSizeRow?.page_size || 0;
      const dbSize = pageCount * pageSize;

      // Get additional metrics
      const tagCountRow = this.db
        .prepare("SELECT COUNT(*) as count FROM tags")
        .get() as any;
      const tagCount = tagCountRow?.count || 0;

      const avgTagsRow = this.db
        .prepare(
          "SELECT AVG(tag_count) as avg FROM (SELECT COUNT(*) as tag_count FROM memory_entry_tags GROUP BY memory_entry_id)",
        )
        .get() as any;
      const avgTagsPerEntry = avgTagsRow?.avg || 0;

      return {
        healthy: true,
        metrics: {
          entryCount,
          dbSizeBytes: dbSize,
          tagCount,
          avgTagsPerEntry: Math.round(avgTagsPerEntry * 100) / 100,
        },
      };
    } catch (error) {
      return {
        healthy: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  async performMaintenance(): Promise<void> {
    if (!this.db) {
      throw new MemoryBackendError("Database not initialized");
    }

    try {
      // Optimize database
      this.db.exec("VACUUM");
      this.db.exec("ANALYZE");

      // Rebuild FTS index
      this.db.exec(
        'INSERT INTO memory_entries_fts(memory_entries_fts) VALUES("rebuild")',
      );

      this.logger.info("Database maintenance completed");
    } catch (error) {
      throw new MemoryBackendError("Failed to perform maintenance", { error });
    }
  }

  private async createSchema(): Promise<void> {
    // Create main tables
    this.db!.exec(`
      CREATE TABLE IF NOT EXISTS memory_entries (
        id TEXT PRIMARY KEY NOT NULL,
        agent_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        type TEXT NOT NULL CHECK (type IN ('observation', 'insight', 'decision', 'artifact', 'error')),
        content TEXT NOT NULL,
        context TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        version INTEGER NOT NULL DEFAULT 1,
        parent_id TEXT,
        metadata TEXT,
        created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
        updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
        FOREIGN KEY (parent_id) REFERENCES memory_entries(id) ON DELETE CASCADE
      )
    `);

    // Create tags table
    this.db!.exec(`
      CREATE TABLE IF NOT EXISTS tags (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE
      )
    `);

    // Create junction table for tags
    this.db!.exec(`
      CREATE TABLE IF NOT EXISTS memory_entry_tags (
        memory_entry_id TEXT NOT NULL,
        tag_id INTEGER NOT NULL,
        PRIMARY KEY (memory_entry_id, tag_id),
        FOREIGN KEY (memory_entry_id) REFERENCES memory_entries(id) ON DELETE CASCADE,
        FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
      )
    `);

    // Create namespaces table
    this.db!.exec(`
      CREATE TABLE IF NOT EXISTS namespaces (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        description TEXT,
        created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000)
      )
    `);

    // Create junction table for namespaces
    this.db!.exec(`
      CREATE TABLE IF NOT EXISTS memory_entry_namespaces (
        memory_entry_id TEXT NOT NULL,
        namespace_id INTEGER NOT NULL,
        PRIMARY KEY (memory_entry_id, namespace_id),
        FOREIGN KEY (memory_entry_id) REFERENCES memory_entries(id) ON DELETE CASCADE,
        FOREIGN KEY (namespace_id) REFERENCES namespaces(id) ON DELETE CASCADE
      )
    `);

    // Create FTS table
    this.db!.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS memory_entries_fts USING fts5(
        id UNINDEXED,
        content,
        context,
        tokenize='porter'
      )
    `);

    // Create indexes
    const indexes = [
      "CREATE INDEX IF NOT EXISTS idx_memory_entries_agent_id ON memory_entries(agent_id)",
      "CREATE INDEX IF NOT EXISTS idx_memory_entries_session_id ON memory_entries(session_id)",
      "CREATE INDEX IF NOT EXISTS idx_memory_entries_type ON memory_entries(type)",
      "CREATE INDEX IF NOT EXISTS idx_memory_entries_timestamp ON memory_entries(timestamp DESC)",
      "CREATE INDEX IF NOT EXISTS idx_memory_entries_parent_id ON memory_entries(parent_id)",
      "CREATE INDEX IF NOT EXISTS idx_memory_entries_agent_session ON memory_entries(agent_id, session_id)",
      "CREATE INDEX IF NOT EXISTS idx_memory_entries_agent_type ON memory_entries(agent_id, type)",
      "CREATE INDEX IF NOT EXISTS idx_memory_entry_tags_entry_id ON memory_entry_tags(memory_entry_id)",
      "CREATE INDEX IF NOT EXISTS idx_memory_entry_tags_tag_id ON memory_entry_tags(tag_id)",
      "CREATE INDEX IF NOT EXISTS idx_memory_entry_namespaces_entry_id ON memory_entry_namespaces(memory_entry_id)",
    ];

    for (const sql of indexes) {
      this.db!.exec(sql);
    }
  }

  private prepareStatements(): void {
    // Prepare frequently used statements
    this.preparedStatements.set(
      "store",
      this.db!.prepare(`
      INSERT OR REPLACE INTO memory_entries (
        id, agent_id, session_id, type, content, 
        context, timestamp, version, parent_id, metadata, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, strftime('%s', 'now') * 1000)
    `),
    );

    this.preparedStatements.set(
      "delete",
      this.db!.prepare("DELETE FROM memory_entries WHERE id = ?"),
    );

    this.preparedStatements.set(
      "insertTag",
      this.db!.prepare("INSERT OR IGNORE INTO tags (name) VALUES (?)"),
    );

    this.preparedStatements.set(
      "linkTag",
      this.db!.prepare(
        "INSERT OR IGNORE INTO memory_entry_tags (memory_entry_id, tag_id) VALUES (?, ?)",
      ),
    );
  }

  private rowToEntry(row: any): MemoryEntry {
    // sqlite3 returns objects with column names as keys
    const entry: MemoryEntry = {
      id: row.id,
      agentId: row.agent_id,
      sessionId: row.session_id,
      type: row.type as MemoryEntry["type"],
      content: row.content,
      context: JSON.parse(row.context),
      timestamp: new Date(row.timestamp),
      version: row.version,
      tags: [],
    };

    // Handle optional fields
    if (row.parent_id !== null) {
      entry.parentId = row.parent_id;
    }

    if (row.metadata !== null) {
      entry.metadata = JSON.parse(row.metadata);
    }

    // Handle tags from GROUP_CONCAT result
    if (row.tag_names) {
      entry.tags = row.tag_names.split(",");
    }

    return entry;
  }
}
