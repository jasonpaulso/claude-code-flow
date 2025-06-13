# Docker Setup Guide for Claude-Flow

This guide covers how to run Claude-Flow using Docker for consistent cross-platform deployment.

## Prerequisites

- Docker installed ([Get Docker](https://docs.docker.com/get-docker/))
- Docker Compose (optional, included with Docker Desktop)

## Quick Start

### 1. Build and Run with Docker

```bash
# Clone the repository
git clone https://github.com/ruvnet/claude-code-flow.git
cd claude-code-flow

# Build the Docker image
docker build -t claude-flow:latest .

# Run Claude-Flow
docker run -it --rm -v $(pwd):/workspace claude-flow:latest --version
```

### 2. Using the Docker Run Script (Easiest)

```bash
# Make the script executable
chmod +x docker-run.sh

# Run any Claude-Flow command
./docker-run.sh --version
./docker-run.sh swarm new "Test task" --dry-run
./docker-run.sh swarm new "Build API" --max-agents 2

# Build/rebuild the image
./docker-run.sh build

# Get a shell inside the container
./docker-run.sh shell
```

## Docker Commands

### Basic Usage

```bash
# Run with current directory mounted
docker run -it --rm \
  -v $(pwd):/workspace \
  claude-flow:latest \
  swarm new "Build feature" --dry-run

# Run with persistent memory
docker run -it --rm \
  -v $(pwd):/workspace \
  -v claude-flow-memory:/opt/claude-flow/memory \
  claude-flow:latest \
  memory query "test"

# Interactive mode
docker run -it --rm \
  -v $(pwd):/workspace \
  --entrypoint /bin/bash \
  claude-flow:latest
```

### Using Docker Compose

```bash
# Start Claude-Flow service
docker-compose up -d

# Run commands
docker-compose exec claude-flow swarm new "Test" --dry-run
docker-compose exec claude-flow memory store "key" "value"

# View logs
docker-compose logs -f claude-flow

# Stop services
docker-compose down
```

### With Monitoring (Optional)

```bash
# Start with monitoring profile
docker-compose --profile monitoring up -d

# Check health endpoint
curl http://localhost:3000/health

# View Prometheus metrics
curl http://localhost:3000/metrics
```

## Environment Configuration

### Using Environment Variables

```bash
# Set via docker run
docker run -it --rm \
  -v $(pwd):/workspace \
  -e CLAUDE_FLOW_LOG_LEVEL=debug \
  -e CLAUDE_FLOW_SWARM_MAX_AGENTS=20 \
  claude-flow:latest \
  swarm new "Complex task"

# Or create .env file
cat > .env << EOF
CLAUDE_FLOW_LOG_LEVEL=info
CLAUDE_FLOW_SWARM_MAX_AGENTS=15
CLAUDE_FLOW_SWARM_STRATEGY=development
CLAUDE_FLOW_SWARM_MONITORING=true
EOF

# Use with docker-compose
docker-compose --env-file .env up
```

## Volume Management

### Persistent Data

Claude-Flow uses Docker volumes for persistent storage:

```bash
# List volumes
docker volume ls | grep claude-flow

# Inspect memory volume
docker volume inspect claude-flow-memory

# Backup memory data
docker run --rm \
  -v claude-flow-memory:/data \
  -v $(pwd):/backup \
  alpine tar czf /backup/claude-flow-memory-backup.tar.gz -C /data .

# Restore memory data
docker run --rm \
  -v claude-flow-memory:/data \
  -v $(pwd):/backup \
  alpine tar xzf /backup/claude-flow-memory-backup.tar.gz -C /data
```

## Advanced Usage

### Multi-Project Setup

Create project-specific containers:

```bash
# Project A
docker run -it --rm \
  --name claude-flow-project-a \
  -v /path/to/project-a:/workspace \
  -v claude-flow-project-a-memory:/opt/claude-flow/memory \
  claude-flow:latest init --sparc

# Project B
docker run -it --rm \
  --name claude-flow-project-b \
  -v /path/to/project-b:/workspace \
  -v claude-flow-project-b-memory:/opt/claude-flow/memory \
  claude-flow:latest init --sparc
```

### CI/CD Integration

#### GitHub Actions

```yaml
name: Claude-Flow CI
on: [push]

jobs:
  claude-flow:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: Build Claude-Flow Docker image
        run: docker build -t claude-flow:latest .
        
      - name: Run swarm test
        run: |
          docker run --rm \
            -v ${{ github.workspace }}:/workspace \
            claude-flow:latest \
            swarm new "Test CI build" --dry-run
```

#### GitLab CI

```yaml
claude-flow-test:
  image: docker:latest
  services:
    - docker:dind
  script:
    - docker build -t claude-flow:latest .
    - docker run --rm -v $CI_PROJECT_DIR:/workspace claude-flow:latest swarm new "Test" --dry-run
```

### Creating Aliases

For convenience, add to your shell profile:

```bash
# ~/.bashrc or ~/.zshrc
alias cf='docker run -it --rm -v $(pwd):/workspace -v claude-flow-memory:/opt/claude-flow/memory claude-flow:latest'

# Usage
cf --version
cf swarm new "Test" --dry-run
cf memory query "data"
```

## Container Management

### Resource Limits

```bash
# Run with resource constraints
docker run -it --rm \
  -v $(pwd):/workspace \
  --memory="2g" \
  --cpus="2" \
  claude-flow:latest \
  swarm new "Resource limited task"
```

### Network Configuration

```bash
# Create custom network
docker network create claude-flow-net

# Run with custom network
docker run -it --rm \
  -v $(pwd):/workspace \
  --network claude-flow-net \
  --name claude-flow-main \
  claude-flow:latest
```

## Troubleshooting

### Common Issues

#### Permission Denied
```bash
# Fix volume permissions
docker run --rm \
  -v $(pwd):/workspace \
  --user $(id -u):$(id -g) \
  claude-flow:latest
```

#### Container Won't Start
```bash
# Check logs
docker logs claude-flow

# Debug mode
docker run -it --rm \
  -v $(pwd):/workspace \
  -e CLAUDE_FLOW_LOG_LEVEL=debug \
  claude-flow:latest
```

#### Out of Space
```bash
# Clean up unused resources
docker system prune -a

# Remove specific volumes
docker volume rm claude-flow-memory claude-flow-config
```

## Security Considerations

### Running as Non-Root

The Dockerfile can be modified to run as non-root:

```dockerfile
# Add to Dockerfile
RUN adduser -D -h /home/claude claude
USER claude
```

### Read-Only Filesystem

```bash
# Run with read-only root filesystem
docker run -it --rm \
  --read-only \
  --tmpfs /tmp \
  -v $(pwd):/workspace \
  claude-flow:latest
```

## Building Custom Images

### Extended Dockerfile

Create `Dockerfile.custom`:

```dockerfile
FROM claude-flow:latest

# Add custom tools
RUN apk add --no-cache python3 py3-pip

# Install additional dependencies
COPY requirements.txt /tmp/
RUN pip3 install -r /tmp/requirements.txt

# Add custom scripts
COPY custom-scripts/ /opt/claude-flow/custom/
ENV PATH="/opt/claude-flow/custom:${PATH}"
```

Build and use:

```bash
docker build -f Dockerfile.custom -t claude-flow-custom:latest .
docker run -it --rm -v $(pwd):/workspace claude-flow-custom:latest
```

## Best Practices

1. **Always mount working directory**: Use `-v $(pwd):/workspace`
2. **Use named volumes**: For persistent data across runs
3. **Set resource limits**: Prevent runaway containers
4. **Use specific tags**: Don't rely on `:latest` in production
5. **Regular updates**: Rebuild images periodically
6. **Security scanning**: Use `docker scan claude-flow:latest`

## Next Steps

- Read the [Getting Started Guide](./01-getting-started.md)
- Configure [Environment Variables](./environment-variables.md)
- Review [Troubleshooting Guide](./10-troubleshooting.md)

Docker provides a consistent, isolated environment for running Claude-Flow across any platform!