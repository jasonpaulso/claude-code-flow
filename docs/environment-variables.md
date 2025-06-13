# Environment Variables

Claude-Flow supports configuration through environment variables, allowing you to customize behavior without modifying configuration files.

## General Configuration

### Core System
- `CLAUDE_FLOW_MAX_AGENTS` - Maximum concurrent agents (default: 10)
- `CLAUDE_FLOW_LOG_LEVEL` - Logging level: debug, info, warn, error (default: info)

### Terminal Management
- `CLAUDE_FLOW_TERMINAL_TYPE` - Terminal type: auto, vscode, native (default: auto)

### Memory System
- `CLAUDE_FLOW_MEMORY_BACKEND` - Memory backend: sqlite, markdown, hybrid (default: hybrid)

### MCP Server
- `CLAUDE_FLOW_MCP_TRANSPORT` - Transport: stdio, http, websocket (default: stdio)
- `CLAUDE_FLOW_MCP_PORT` - Port for HTTP/WebSocket transport (default: 3000)

## Swarm Configuration (NEW!)

### Basic Settings
- `CLAUDE_FLOW_SWARM_MAX_AGENTS` - Maximum agents in swarm (1-100, default: 10)
- `CLAUDE_FLOW_SWARM_TIMEOUT` - Timeout in minutes (1-1440, default: 60)

### Strategy Settings
- `CLAUDE_FLOW_SWARM_STRATEGY` - Default strategy:
  - `auto` - Automatic strategy selection (default)
  - `research` - Research-focused workflows
  - `development` - Code development workflows
  - `analysis` - Data analysis workflows
  - `testing` - Quality assurance workflows
  - `optimization` - Performance optimization
  - `maintenance` - System maintenance

### Coordination Settings
- `CLAUDE_FLOW_SWARM_MODE` - Coordination mode:
  - `centralized` - Single coordinator (default)
  - `distributed` - Multiple coordinators
  - `hierarchical` - Tree structure
  - `mesh` - Peer-to-peer
  - `hybrid` - Mixed strategies

### Feature Flags
- `CLAUDE_FLOW_SWARM_MONITORING` - Enable monitoring: true/false (default: true)
- `CLAUDE_FLOW_SWARM_ENCRYPTION` - Enable encryption: true/false (default: false)

## Usage Examples

### Development Environment
```bash
export CLAUDE_FLOW_LOG_LEVEL=debug
export CLAUDE_FLOW_SWARM_MAX_AGENTS=5
export CLAUDE_FLOW_SWARM_STRATEGY=development
export CLAUDE_FLOW_SWARM_MODE=centralized
export CLAUDE_FLOW_SWARM_MONITORING=true

./bin/claude-flow-launcher swarm new "Build API" --max-agents 5
```

### Production Environment
```bash
export CLAUDE_FLOW_LOG_LEVEL=warn
export CLAUDE_FLOW_SWARM_MAX_AGENTS=20
export CLAUDE_FLOW_SWARM_STRATEGY=auto
export CLAUDE_FLOW_SWARM_MODE=distributed
export CLAUDE_FLOW_SWARM_MONITORING=true
export CLAUDE_FLOW_SWARM_ENCRYPTION=true

./bin/claude-flow-launcher swarm new "Production deployment"
```

### Research Environment
```bash
export CLAUDE_FLOW_SWARM_STRATEGY=research
export CLAUDE_FLOW_SWARM_MODE=mesh
export CLAUDE_FLOW_SWARM_MAX_AGENTS=15
export CLAUDE_FLOW_SWARM_TIMEOUT=120

./bin/claude-flow-launcher swarm new "Research AI trends"
```

### Testing Environment
```bash
export CLAUDE_FLOW_LOG_LEVEL=debug
export CLAUDE_FLOW_SWARM_STRATEGY=testing
export CLAUDE_FLOW_SWARM_MODE=hierarchical
export CLAUDE_FLOW_SWARM_MONITORING=true

./bin/claude-flow-launcher swarm new "Test coverage analysis"
```

## Configuration Priority

Environment variables override default configuration but are overridden by:

1. **Command-line arguments** (highest priority)
2. **Configuration file settings**
3. **Environment variables** 
4. **Default values** (lowest priority)

## Example Configuration Override

```bash
# Set environment defaults
export CLAUDE_FLOW_SWARM_MAX_AGENTS=10
export CLAUDE_FLOW_SWARM_STRATEGY=development

# Override with command line (takes precedence)
./bin/claude-flow-launcher swarm new "task" --max-agents 5 --strategy research
# Result: Uses 5 agents with research strategy
```

## Validation

All environment variables are validated according to the same rules as configuration files:

- **Numbers**: Must be within valid ranges
- **Strings**: Must match allowed values
- **Booleans**: Must be 'true' or 'false'

Invalid values will result in validation errors on startup.

## Docker Integration

Environment variables work seamlessly with Docker:

```dockerfile
ENV CLAUDE_FLOW_SWARM_MAX_AGENTS=15
ENV CLAUDE_FLOW_SWARM_STRATEGY=development
ENV CLAUDE_FLOW_SWARM_MONITORING=true
ENV CLAUDE_FLOW_LOG_LEVEL=info
```

Or using docker-compose:

```yaml
services:
  claude-flow:
    environment:
      - CLAUDE_FLOW_SWARM_MAX_AGENTS=15
      - CLAUDE_FLOW_SWARM_STRATEGY=development
      - CLAUDE_FLOW_SWARM_MONITORING=true
      - CLAUDE_FLOW_LOG_LEVEL=info
```

## Configuration File Generation

You can generate a configuration file with current environment settings:

```bash
# This would create a config file with environment variable values
./bin/claude-flow-launcher config init --from-env
```

This allows you to capture environment-based configurations as persistent files.