# Testing Orchestrator IPC

## The Problem

When you run `claude-flow start` in one terminal, other terminals can't see or communicate with the running orchestrator. The `claude-flow status` command returns mock data instead of real status.

## The Solution

I've implemented a health server that:

1. Starts automatically with the orchestrator
2. Listens on port 3001
3. Writes a status file (`.claude-flow.status.json`) with connection info
4. Provides HTTP endpoints for health checks and status

## New Endpoints

- `http://localhost:3001/health` - Full health check
- `http://localhost:3001/health/quick` - Quick health check
- `http://localhost:3001/status` - Full system status
- `http://localhost:3001/metrics` - Prometheus metrics

## How It Works

1. When orchestrator starts, it also starts the health server
2. Health server writes `.claude-flow.status.json` with connection info
3. Other terminals read this file to find the health server
4. They can then query the actual orchestrator status via HTTP

## Testing Steps

1. Terminal 1: `claude-flow start`
2. Terminal 2: `claude-flow status` (should now show real data)
3. Terminal 2: `curl http://localhost:3001/health`

## Implementation Files

- `src/monitoring/health-server.ts` - HTTP server for health checks
- `src/monitoring/health-endpoint.ts` - Health check logic
- `src/cli/commands/status.ts` - Updated to use health server
- `src/cli/commands/start/process-manager.ts` - Manages health server lifecycle
