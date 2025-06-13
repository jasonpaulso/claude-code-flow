# Getting Started with Claude-Flow

Welcome to Claude-Flow, an advanced AI agent orchestration system designed for sophisticated multi-agent collaboration, task coordination, and memory management. This guide will help you get up and running quickly.

## ⚠️ Current Status (June 13, 2025)
**CORE SWARM FUNCTIONALITY IS WORKING!** 🎉

The system is production-ready with the swarm orchestration features. Please use the launcher script (`./bin/claude-flow-launcher`) instead of the compiled binary due to a known build issue.

## Quick Installation

### Option 1: NPX with SPARC (Recommended) ✅
```bash
# Initialize with SPARC development environment
npx -y claude-flow@latest init --sparc

# This creates:
# - CLAUDE.md - Project configuration
# - ./bin/claude-flow-launcher - Working executable
# - Memory and configuration files
```

### Option 2: Local Installation (For Development)
```bash
# Clone the repository
git clone https://github.com/ruvnet/claude-code-flow.git
cd claude-code-flow

# Install globally
npm link

# Now use from anywhere
claude-flow --version

# Verify installation
which claude-flow  # Should show the global install path
```

## Working Commands ✅

### 1. Test Swarm Functionality
```bash
# Test swarm creation (dry-run)
claude-flow swarm new "Test task" --dry-run

# Run actual swarm (WORKING!)
claude-flow swarm new "Build a REST API" --max-agents 1

# Get help
claude-flow swarm --help
```

### 2. Memory Operations (WORKING)
```bash
# Store data
claude-flow memory store "key" "value"

# Query memory
claude-flow memory query "search term"
```

### 3. Check Version
```bash
# Verify installation
claude-flow --version
# Output: claude-flow v1.0.43
```

## Your First Swarm Workflow 🐝

Let's create a simple swarm to demonstrate Claude-Flow's working capabilities:

### Step 1: Initialize the Project
```bash
# If you haven't already, initialize with SPARC
npx -y claude-flow@latest init --sparc
```

### Step 2: Test Swarm Creation
```bash
# Test configuration without execution
claude-flow swarm new "Research AI trends" --dry-run

# You'll see the swarm configuration output
```

### Step 3: Run a Real Swarm
```bash
# Create and run a simple swarm
claude-flow swarm new "Build a simple REST API" --max-agents 1

# The swarm will:
# - Initialize coordinator
# - Set up memory systems
# - Create agents
# - Execute the objective
```

### Step 4: Check Results
```bash
# Results are saved in the swarm directory
ls -la swarms/

# Memory operations
./bin/claude-flow-launcher memory query "REST API"
```

## Interactive Exploration

For learning and experimentation, use the interactive REPL mode:

```bash
# Start interactive session
claude-flow repl
```

In REPL mode, you can:
```bash
# Get help
> help

# Spawn agents interactively
> agent spawn coordinator --name "Project Manager"

# Create tasks
> task create analysis "Evaluate system performance"

# Query memory
> memory query --recent --limit 5

# Exit REPL
> exit
```

## Basic Concepts

### Agents
Agents are specialized AI workers with specific capabilities:
- **Researcher**: Information gathering and analysis
- **Implementer**: Code development and technical tasks
- **Analyst**: Data analysis and pattern recognition
- **Coordinator**: Planning and task delegation

### Tasks
Tasks represent work to be done:
- **Research**: Information gathering
- **Implementation**: Code development
- **Analysis**: Data processing
- **Coordination**: Planning and management

### Memory Bank
The memory system stores:
- Agent discoveries and insights
- Task progress and results
- Shared knowledge across agents
- Project history and context

### MCP Integration
Model Context Protocol enables:
- External tool integration
- API connectivity
- Custom tool development
- Secure tool execution

## Common Commands Reference

### Agent Management
```bash
# List all agents
claude-flow agent list

# Get detailed agent info
claude-flow agent info <agent-id>

# Terminate an agent
claude-flow agent terminate <agent-id>
```

### Task Management
```bash
# List all tasks
claude-flow task list

# Check task status
claude-flow task status <task-id>

# Cancel a task
claude-flow task cancel <task-id>
```

### Memory Operations
```bash
# Search memory
claude-flow memory query --search "keyword"

# View memory stats
claude-flow memory stats

# Clean up old entries
claude-flow memory cleanup --older-than 30d
```

### Configuration
```bash
# View current config
claude-flow config show

# Update settings
claude-flow config set orchestrator.maxConcurrentAgents 15

# Reset to defaults
claude-flow config init --force
```

## Next Steps

1. **Explore the Architecture**: Read [02-architecture-overview.md](./02-architecture-overview.md) to understand how Claude-Flow works
2. **Configure Your System**: See [03-configuration-guide.md](./03-configuration-guide.md) for detailed configuration options
3. **Learn Agent Management**: Check [04-agent-management.md](./04-agent-management.md) for advanced agent patterns
4. **Create Complex Workflows**: Study [05-task-coordination.md](./05-task-coordination.md) for workflow orchestration

## Getting Help

- Use `claude-flow help` for command-line help
- Join our [Discord community](https://discord.gg/claude-flow)
- Check [GitHub Issues](https://github.com/ruvnet/claude-code-flow/issues)
- Review the [full documentation](https://claude-flow.dev/docs)

## Troubleshooting Common Issues

### 🔧 Known Issues and Solutions

#### Build System Issue
**Problem**: `deno compile` fails with stack overflow
```
error: RangeError: Maximum call stack size exceeded
```
**Solution**: Use the launcher script
```bash
# Always use:
./bin/claude-flow-launcher

# NOT:
./bin/claude-flow  # This will fail
```

#### Permission Issues
**Problem**: Permission denied when running commands
**Solution**: Make launcher executable
```bash
chmod +x bin/claude-flow-launcher
```

#### Process Hanging
**Problem**: Commands hang or timeout
**Solution**: Use `--no-wait` flag
```bash
./bin/claude-flow-launcher swarm new "task" --no-wait
```

### For detailed troubleshooting, see:
- [Complete Troubleshooting Guide](./10-troubleshooting.md)
- [Environment Variables](./environment-variables.md)

You're now ready to start using Claude-Flow! Continue to the next sections for more advanced features and configuration options.