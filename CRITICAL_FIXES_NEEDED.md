# Critical Fixes Needed for Claude-Flow

## Executive Summary

The Claude-Flow system is 90% complete but requires critical integration work to become fully functional. All core components work individually, but key connections between them are missing.

## Current System Status

### ✅ Working Components

1. **SQLite Backend** - Fully implemented and functional
2. **Memory Manager** - Initializes successfully with SQLite
3. **Terminal Manager** - Works with native adapter
4. **Health Server** - Provides metrics and monitoring endpoints
5. **Swarm Coordinator** - Creates objectives, decomposes tasks, manages agents
6. **AgentSpawner** - Class exists with full implementation
7. **CLI System** - All commands functional
8. **Configuration** - Properly loads and applies settings

### ❌ Critical Issues

#### 1. MCP Server Duplicate Initialization

**Problem**: MCP server is initialized twice - once by ProcessManager and once by Orchestrator
**Impact**: Orchestrator fails to start, preventing full system initialization
**Location**:

- `src/cli/commands/start/process-manager.ts` (line ~150)
- `src/core/orchestrator.ts` (line ~356)

#### 2. Agent Spawner Not Integrated

**Problem**: AgentSpawner class exists but is never used by SwarmCoordinator
**Impact**: Tasks are created but never executed
**Location**: `src/swarm/coordinator.ts` - missing import and usage

#### 3. Task Execution Pipeline Broken

**Problem**: Tasks are queued but the execution pipeline doesn't spawn actual processes
**Impact**: Swarms create tasks but nothing happens
**Location**: `src/swarm/coordinator.ts` - `executeClaudeTask` method

## Required Fixes

### Fix 1: MCP Server Initialization (Priority: CRITICAL)

**Solution**: Ensure MCP server is only initialized once

```typescript
// Option A: Remove from ProcessManager
// In src/cli/commands/start/process-manager.ts, remove the MCP_SERVER case

// Option B: Pass existing MCP server to Orchestrator
// In src/core/orchestrator.ts constructor, accept optional mcpServer parameter
constructor(
  terminalManager: ITerminalManager,
  memoryManager: IMemoryManager,
  coordinationManager: ICoordinationManager,
  sessionManager: ISessionManager,
  eventBus: IEventBus,
  mcpServer?: IMCPServer  // Optional parameter
)

// Then in initialize(), only create if not provided:
if (!this.mcpServer) {
  this.mcpServer = new MCPServer(config.mcp, this.eventBus, this.logger);
}
```

### Fix 2: Integrate AgentSpawner (Priority: CRITICAL)

**Location**: `src/swarm/coordinator.ts`

**Steps**:

1. Import AgentSpawner class
2. Initialize in constructor
3. Use in executeClaudeTask method

```typescript
// Add import at top
import { AgentSpawner } from './agent-spawner.ts';

// Add to class properties
private agentSpawner: AgentSpawner;

// Initialize in constructor
constructor(...) {
  // ... existing code
  this.agentSpawner = new AgentSpawner(logger);
}

// Modify executeClaudeTask to use spawner
private async executeClaudeTask(
  task: TaskDefinition,
  agent: AgentState,
  prompt: string,
  targetDir: string | null
): Promise<any> {
  // Spawn actual Claude process
  const agentProcess = await this.agentSpawner.spawnAgent(
    agent.id.id,
    {
      objective: task.description,
      context: prompt,
      workingDirectory: targetDir || process.cwd()
    }
  );

  // Set up result handling
  return new Promise((resolve, reject) => {
    let result = '';

    agentProcess.on('output', (data) => {
      result += data;
    });

    agentProcess.on('error', (error) => {
      reject(error);
    });

    agentProcess.on('complete', () => {
      resolve(JSON.parse(result));
    });

    // Send task to agent
    agentProcess.send({
      type: 'execute',
      task: {
        id: task.id.id,
        description: task.description,
        prompt: prompt
      }
    });
  });
}
```

### Fix 3: Agent Process Protocol (Priority: HIGH)

**Problem**: Need to define how coordinator communicates with spawned agents

**Solution**: Implement IPC protocol

```typescript
// Define message types
interface AgentMessage {
  type: "execute" | "status" | "heartbeat" | "result" | "error";
  taskId?: string;
  data?: any;
}

// In agent process (new file: src/swarm/agent-worker.ts)
process.on("message", async (message: AgentMessage) => {
  switch (message.type) {
    case "execute":
      try {
        // Execute task using Claude API or simulation
        const result = await executeTask(message.data);
        process.send({ type: "result", taskId: message.taskId, data: result });
      } catch (error) {
        process.send({
          type: "error",
          taskId: message.taskId,
          data: error.message,
        });
      }
      break;
    case "heartbeat":
      process.send({ type: "heartbeat", data: { alive: true } });
      break;
  }
});
```

### Fix 4: Task Assignment Flow (Priority: HIGH)

**Location**: `src/swarm/coordinator.ts` - `assignTask` method

**Current**: Tasks are assigned but execution is not triggered
**Fix**: Call startTaskExecution after assignment

```typescript
async assignTask(taskId: string, agentId?: string): Promise<void> {
  // ... existing assignment code ...

  // After successful assignment, start execution
  await this.startTaskExecution(task);
}
```

## Testing Plan

### Step 1: Fix MCP Server

1. Apply MCP server fix
2. Run: `./bin/claude-flow-launcher start --daemon --config ./claude-flow.config.json`
3. Verify: No "MCP server already running" error
4. Check: `./bin/claude-flow-launcher status` shows healthy orchestrator

### Step 2: Test Agent Spawning

1. Apply AgentSpawner integration
2. Run simple swarm: `./bin/claude-flow-launcher swarm "Create test.txt with 'Hello'" --max-agents 1`
3. Verify: Agent process spawns (check `ps aux | grep claude`)
4. Check: Task moves from 'queued' to 'assigned' to 'executing'

### Step 3: End-to-End Test

1. Run complex swarm: `./bin/claude-flow-launcher swarm "Analyze src folder and create report" --max-agents 3`
2. Verify: Multiple agents spawn
3. Check: Tasks complete successfully
4. Verify: Output files are created

## Implementation Order

1. **Fix MCP Server** (30 minutes)
   - Choose approach (remove from ProcessManager or make optional)
   - Test daemon startup
2. **Integrate AgentSpawner** (1 hour)
   - Import and initialize
   - Wire up in executeClaudeTask
   - Add error handling
3. **Implement IPC Protocol** (2 hours)
   - Create agent-worker.ts
   - Define message protocol
   - Handle bidirectional communication
4. **Fix Task Flow** (30 minutes)
   - Ensure assignTask triggers execution
   - Add proper state transitions
5. **Testing** (1 hour)
   - Run test scenarios
   - Fix any issues
   - Document results

## Expected Outcome

After these fixes:

1. ✅ Daemon starts without errors
2. ✅ Swarms spawn actual Claude processes
3. ✅ Tasks execute and complete
4. ✅ Results are returned to coordinator
5. ✅ Files are created/modified as requested
6. ✅ Full end-to-end functionality

## Alternative: Mock Mode

If Claude process spawning proves complex, implement mock mode first:

```typescript
// In AgentSpawner
async spawnAgent(agentId: string, config: AgentConfig): Promise<AgentProcess> {
  if (this.mockMode) {
    return new MockAgentProcess(agentId, config);
  }
  // Real implementation
}

// MockAgentProcess simulates Claude responses
class MockAgentProcess extends EventEmitter {
  async send(message: AgentMessage) {
    // Simulate processing delay
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Return mock result based on task
    this.emit('complete', {
      success: true,
      output: `Mock execution of: ${message.data.description}`
    });
  }
}
```

This allows testing the full flow without actual Claude processes.
