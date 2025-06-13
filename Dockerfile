# Claude-Flow Docker Image - Deno-based
FROM denoland/deno:alpine

# Set working directory
WORKDIR /opt/claude-flow

# Copy source code
COPY . .

# Use Docker-specific deno config without unsupported options
RUN if [ -f deno-docker.json ]; then mv deno-docker.json deno.json; fi

# Create a wrapper script that uses Deno directly
RUN echo '#!/bin/sh' > /usr/local/bin/claude-flow && \
    echo 'exec deno run --allow-all /opt/claude-flow/src/cli/main.ts "$@"' >> /usr/local/bin/claude-flow && \
    chmod +x /usr/local/bin/claude-flow

# Create workspace directory for user projects
RUN mkdir -p /workspace

# Set environment variables
ENV CLAUDE_FLOW_DOCKER=true
ENV PATH="/usr/local/bin:${PATH}"

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD claude-flow --version || exit 1

# Default working directory for user projects
WORKDIR /workspace

# Run as a service that keeps the container alive
# Users can docker exec into it or use docker run with custom commands
ENTRYPOINT ["tail", "-f", "/dev/null"]