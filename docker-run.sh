#!/bin/bash
# Claude-Flow Docker Runner Script

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Script directory
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

# Function to print colored output
print_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if Docker is installed
if ! command -v docker &> /dev/null; then
    print_error "Docker is not installed. Please install Docker first."
    exit 1
fi

# Build the Docker image if needed
build_image() {
    print_info "Building Claude-Flow Docker image..."
    
    # Try main Dockerfile first
    if docker build -t claude-flow:latest "$SCRIPT_DIR"; then
        print_success "Docker image built successfully!"
    else
        print_error "Main build failed, trying minimal build..."
        # Try minimal Dockerfile without problematic dependencies
        if docker build -f "$SCRIPT_DIR/Dockerfile.minimal" -t claude-flow:latest "$SCRIPT_DIR"; then
            print_success "Minimal Docker image built successfully!"
            print_info "Note: Some features (like blessed UI) may not be available"
        else
            print_error "Failed to build Docker image"
            exit 1
        fi
    fi
}

# Run Claude-Flow in Docker
run_claude_flow() {
    # Check if image exists
    if [[ "$(docker images -q claude-flow:latest 2> /dev/null)" == "" ]]; then
        print_info "Docker image not found. Building..."
        build_image
    fi

    # Run the container with all arguments passed through
    docker run -it --rm \
        -v "$(pwd):/workspace" \
        -v claude-flow-memory:/opt/claude-flow/memory \
        -v claude-flow-config:/opt/claude-flow/config \
        -e CLAUDE_FLOW_LOG_LEVEL="${CLAUDE_FLOW_LOG_LEVEL:-info}" \
        -e CLAUDE_FLOW_SWARM_MAX_AGENTS="${CLAUDE_FLOW_SWARM_MAX_AGENTS:-10}" \
        --name claude-flow-session-$$ \
        claude-flow:latest "$@"
}

# Handle special commands
case "$1" in
    "build")
        build_image
        ;;
    "shell")
        print_info "Starting interactive shell in Claude-Flow container..."
        docker run -it --rm \
            -v "$(pwd):/workspace" \
            -v claude-flow-memory:/opt/claude-flow/memory \
            -v claude-flow-config:/opt/claude-flow/config \
            --entrypoint /bin/bash \
            claude-flow:latest
        ;;
    "compose")
        shift
        print_info "Running docker-compose command..."
        docker-compose -f "$SCRIPT_DIR/docker-compose.yml" "$@"
        ;;
    "update")
        print_info "Updating Claude-Flow Docker image..."
        docker pull denoland/deno:alpine-1.40.0
        build_image
        ;;
    *)
        run_claude_flow "$@"
        ;;
esac