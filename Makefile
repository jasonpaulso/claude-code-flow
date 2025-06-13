# Claude-Flow Docker Makefile
.PHONY: help build run shell test clean push pull compose-up compose-down

# Default target
help:
	@echo "Claude-Flow Docker Commands:"
	@echo "  make build       - Build the Docker image"
	@echo "  make run         - Run Claude-Flow (pass ARGS=... for commands)"
	@echo "  make shell       - Start interactive shell in container"
	@echo "  make test        - Run tests in Docker"
	@echo "  make clean       - Clean up Docker resources"
	@echo "  make compose-up  - Start services with docker-compose"
	@echo "  make compose-down - Stop services"
	@echo ""
	@echo "Examples:"
	@echo "  make run ARGS='--version'"
	@echo "  make run ARGS='swarm new \"Test task\" --dry-run'"

# Build Docker image
build:
	@echo "Building Claude-Flow Docker image..."
	docker build -t claude-flow:latest .

# Run Claude-Flow with arguments
run: build
	@docker run -it --rm \
		-v $(PWD):/workspace \
		-v claude-flow-memory:/opt/claude-flow/memory \
		-v claude-flow-config:/opt/claude-flow/config \
		claude-flow:latest $(ARGS)

# Interactive shell
shell: build
	@docker run -it --rm \
		-v $(PWD):/workspace \
		-v claude-flow-memory:/opt/claude-flow/memory \
		-v claude-flow-config:/opt/claude-flow/config \
		--entrypoint /bin/bash \
		claude-flow:latest

# Run tests
test: build
	@docker run -it --rm \
		-v $(PWD):/workspace \
		claude-flow:latest test

# Clean up Docker resources
clean:
	@echo "Cleaning up Docker resources..."
	@docker rmi claude-flow:latest 2>/dev/null || true
	@docker volume rm claude-flow-memory claude-flow-config 2>/dev/null || true
	@docker system prune -f

# Docker Compose commands
compose-up:
	docker-compose up -d

compose-down:
	docker-compose down

compose-logs:
	docker-compose logs -f

# Quick commands
version: build
	@make run ARGS="--version"

swarm-test: build
	@make run ARGS='swarm new "Test Docker swarm" --dry-run'

swarm-run: build
	@make run ARGS='swarm new "$(TASK)" --max-agents $(AGENTS)'

# Set defaults
TASK ?= "Default task"
AGENTS ?= 2