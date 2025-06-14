# SQLite Backend Implementation

This document describes the SQLite backend implementation for the Claude-Flow memory system.

## Overview

The SQLite backend provides persistent memory storage using a SQLite database. It implements the `IMemoryBackend` interface and offers full support for all memory operations including storage, retrieval, querying, and management of memory entries.

## Features

- **Persistent Storage**: Data is stored in a SQLite database file
- **Full-Text Search**: Uses SQLite's FTS5 for efficient content searching
- **Tag Support**: Many-to-many relationship for flexible tagging
- **Namespace Support**: Organize memory entries into namespaces
- **Version History**: Track changes to memory entries over time
- **Parent-Child Relationships**: Support for hierarchical memory structures
- **Performance Optimizations**: Prepared statements, indexes, and WAL mode
- **Transaction Support**: ACID compliance for data integrity

## Database Schema

### Core Tables

1. **memory_entries**: Main table storing memory entries

   - `id`: Primary key
   - `agent_id`: Agent identifier
   - `session_id`: Session identifier
   - `type`: Entry type (observation, insight, decision, artifact, error)
   - `content`: Main content
   - `context`: JSON-encoded context data
   - `timestamp`: Unix timestamp in milliseconds
   - `version`: Version number
   - `parent_id`: Reference to parent entry
   - `metadata`: JSON-encoded metadata
   - `created_at`: Creation timestamp
   - `updated_at`: Last update timestamp

2. **tags**: Stores unique tag names

   - `id`: Primary key
   - `name`: Unique tag name

3. **memory_entry_tags**: Junction table for tags

   - `memory_entry_id`: Foreign key to memory_entries
   - `tag_id`: Foreign key to tags

4. **namespaces**: Namespace definitions

   - `id`: Primary key
   - `name`: Unique namespace name
   - `description`: Optional description
   - `created_at`: Creation timestamp

5. **memory_entry_namespaces**: Junction table for namespaces

   - `memory_entry_id`: Foreign key to memory_entries
   - `namespace_id`: Foreign key to namespaces

6. **memory_entries_fts**: Full-text search virtual table
   - Indexes content and context for fast searching

### Performance Indexes

- Agent ID index for fast agent-based queries
- Session ID index for session-based queries
- Type index for filtering by entry type
- Timestamp index for time-based queries
- Parent ID index for hierarchical queries
- Composite indexes for common query patterns

## Implementation Details

### Technology Stack

- **Database Library**: sqlite3 for Deno (v0.12.0)
- **Language**: TypeScript
- **Platform**: Deno

### Key Methods

1. **initialize()**: Sets up database connection and schema
2. **store()**: Saves or updates memory entries with tags
3. **retrieve()**: Gets a single entry by ID
4. **query()**: Advanced querying with filters, search, and pagination
5. **delete()**: Removes entries and related data
6. **getAllEntries()**: Returns all entries
7. **getHealthStatus()**: Database health and metrics
8. **performMaintenance()**: Optimizes database (VACUUM, ANALYZE)

### Transaction Management

All write operations use transactions to ensure data consistency:

```typescript
this.db.exec("BEGIN TRANSACTION");
try {
  // Perform operations
  this.db.exec("COMMIT");
} catch (error) {
  this.db.exec("ROLLBACK");
  throw error;
}
```

### Prepared Statements

Frequently used queries are prepared at initialization for better performance:

- Store entry statement
- Delete entry statement
- Tag insertion statement
- Tag linking statement

## Usage Example

```typescript
import { SQLiteBackend } from "./src/memory/backends/sqlite.ts";
import { createLogger } from "./src/core/logger.ts";

// Create backend instance
const logger = createLogger({ level: "info" });
const backend = new SQLiteBackend("./memory.db", logger);

// Initialize
await backend.initialize();

// Store an entry
const entry = {
  id: "entry-123",
  agentId: "agent-1",
  sessionId: "session-1",
  type: "observation",
  content: "User requested feature X",
  context: { task: "feature-request", priority: "high" },
  timestamp: new Date(),
  tags: ["feature", "user-request"],
  version: 1,
};

await backend.store(entry);

// Query entries
const results = await backend.query({
  agentId: "agent-1",
  type: "observation",
  tags: ["feature"],
  limit: 10,
});

// Clean up
await backend.shutdown();
```

## Configuration

### Database Settings

The backend applies these optimizations at initialization:

- **Foreign Keys**: Enabled for referential integrity
- **WAL Mode**: Write-Ahead Logging for better concurrency
- **Synchronous**: NORMAL mode for balanced safety/performance
- **Cache Size**: 64MB memory cache
- **Temp Store**: In-memory temporary storage

### Performance Tuning

For optimal performance:

1. Run maintenance periodically: `await backend.performMaintenance()`
2. Use prepared statements for repeated queries
3. Batch operations within transactions
4. Create appropriate indexes for your query patterns
5. Monitor health metrics regularly

## Testing

Comprehensive unit tests are provided in `tests/unit/memory/sqlite-backend.test.ts`:

- Initialization and schema creation
- CRUD operations
- Complex queries with filters
- Tag and namespace support
- Transaction handling
- Error scenarios
- Performance metrics

Run tests:

```bash
deno test tests/unit/memory/sqlite-backend.test.ts --allow-read --allow-write
```

## Migration from Other Backends

To migrate from another backend (e.g., Markdown):

```typescript
// Load from old backend
const oldBackend = new MarkdownBackend("./memory", logger);
await oldBackend.initialize();
const entries = await oldBackend.getAllEntries();

// Store in SQLite
const sqliteBackend = new SQLiteBackend("./memory.db", logger);
await sqliteBackend.initialize();

for (const entry of entries) {
  await sqliteBackend.store(entry);
}

await oldBackend.shutdown();
await sqliteBackend.shutdown();
```

## Troubleshooting

### Common Issues

1. **Permission Errors**: Ensure write permissions for database directory
2. **Lock Errors**: Check for other processes accessing the database
3. **Performance Issues**: Run maintenance, check indexes
4. **Memory Usage**: Monitor cache size settings

### Debug Logging

Enable debug logging for detailed information:

```typescript
const logger = createLogger({ level: "debug" });
```

## Future Enhancements

Potential improvements:

1. **Encryption**: Add support for encrypted databases
2. **Replication**: Master-slave replication for scalability
3. **Compression**: Compress large content fields
4. **Partitioning**: Time-based partitioning for large datasets
5. **Analytics**: Built-in analytics queries
6. **Backup**: Automated backup functionality
