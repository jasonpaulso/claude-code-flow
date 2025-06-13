# Docker Usage Guide for Claude-Flow

## Quick Start

### Build and Run

```bash
# Build the Docker image
docker build -t claude-flow:latest .

# Run as a persistent service
docker run -d --name claude-flow \
  -v $(pwd):/workspace \
  -e ANTHROPIC_API_KEY=$ANTHROPIC_API_KEY \
  claude-flow:latest

# Execute commands inside the container
docker exec claude-flow claude-flow --version
docker exec claude-flow claude-flow swarm new "Test task" --dry-run
```

### Using Docker Compose

```bash
# Start the service
docker-compose up -d

# Execute commands
docker-compose exec claude-flow claude-flow --version
docker-compose exec claude-flow claude-flow swarm new "Analyze codebase"

# View logs
docker-compose logs -f claude-flow

# Stop the service
docker-compose down
```

## Architecture

The Docker image uses a Deno-only approach to avoid Node.js dependency conflicts:

- Base image: `denoland/deno:alpine` (lightweight and efficient)
- Claude-Flow runs directly with Deno
- Container runs as a persistent service using `tail -f /dev/null`
- Commands are executed via `docker exec`

## Volume Mounts

- `/workspace`: Your project directory (mount your code here)
- `/opt/claude-flow/memory`: Persistent memory storage
- `/opt/claude-flow/config`: Configuration persistence

## Environment Variables

Set these in your docker run command or docker-compose.yml:

```bash
ANTHROPIC_API_KEY=your-api-key
CLAUDE_FLOW_LOG_LEVEL=info|debug|warn|error
CLAUDE_FLOW_SWARM_MAX_AGENTS=10
CLAUDE_FLOW_SWARM_STRATEGY=auto|sequential|parallel
CLAUDE_FLOW_SWARM_MODE=centralized|distributed
CLAUDE_FLOW_SWARM_MONITORING=true|false
```

## Examples

### Interactive Session

```bash
docker run -it --rm \
  -v $(pwd):/workspace \
  -e ANTHROPIC_API_KEY=$ANTHROPIC_API_KEY \
  --entrypoint /bin/sh \
  claude-flow:latest
```

### Running a Swarm Task

```bash
docker exec claude-flow claude-flow swarm new \
  "Refactor authentication system" \
  --max-agents 3 \
  --strategy sequential
```

### Batch Processing

```bash
# Create a script inside the container
docker exec claude-flow sh -c 'cat > /tmp/batch.sh << EOF
#!/bin/sh
claude-flow swarm new "Task 1" --max-agents 1
claude-flow swarm new "Task 2" --max-agents 1
claude-flow swarm new "Task 3" --max-agents 1
EOF'

# Execute the batch
docker exec claude-flow sh /tmp/batch.sh
```

## Troubleshooting

### Container Won't Stay Running

The container is designed to run as a service. Use `docker logs claude-flow` to check for errors.

### Permission Issues

Ensure your workspace directory has appropriate permissions:

```bash
chmod -R 755 ./workspace
```

### Memory Persistence

Memory is stored in Docker volumes. To reset:

```bash
docker volume rm claude-flow-memory claude-flow-config
```

## Production Deployment

For production use:

1. Use specific version tags instead of `:latest`
2. Set resource limits in docker-compose.yml
3. Configure proper logging drivers
4. Use secrets management for API keys
5. Set up monitoring and alerting

Example production docker-compose.yml snippet:

```yaml
services:
  claude-flow:
    image: claude-flow:v1.0.43
    deploy:
      resources:
        limits:
          cpus: '2'
          memory: 4G
        reservations:
          memory: 2G
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "3"
```
