/**
 * Swarm command for Claude-Flow using Cliffy
 */

import { Command } from "@cliffy/command";
import { colors } from "@cliffy/ansi/colors";
import { swarmAction } from "./swarm-new.ts";

export const swarmCommand = new Command()
  .description("Create self-orchestrating Claude agent swarms")
  .arguments("<objective:string>")
  .option(
    "-s, --strategy <strategy:string>",
    "Orchestration strategy (auto, research, development, analysis)",
    {
      default: "auto",
    },
  )
  .option("--max-agents <count:number>", "Maximum number of agents to spawn", {
    default: 5,
  })
  .option("--max-depth <depth:number>", "Maximum delegation depth", {
    default: 3,
  })
  .option("-r, --research", "Enable research capabilities for all agents")
  .option("-p, --parallel", "Enable parallel execution")
  .option("--memory-namespace <namespace:string>", "Shared memory namespace", {
    default: "swarm",
  })
  .option("--timeout <minutes:number>", "Swarm timeout in minutes", {
    default: 60,
  })
  .option("--review", "Enable peer review between agents")
  .option("--coordinator", "Spawn dedicated coordinator agent")
  .option("-m, --monitor", "Enable real-time monitoring")
  .option("--ui", "Use blessed terminal UI")
  .option("-d, --dry-run", "Preview swarm configuration")
  .option("--distributed", "Enable distributed coordination")
  .option(
    "--mode <mode:string>",
    "Coordination mode (centralized, distributed)",
    {
      default: "centralized",
    },
  )
  .option(
    "--quality-threshold <threshold:number>",
    "Quality threshold for task completion",
    {
      default: 0.8,
    },
  )
  .option("--testing", "Enable testing mode with reduced resources")
  .option("--encryption", "Enable memory encryption")
  .option("--background", "Run swarm in background mode")
  .option("--no-wait", "Start swarm and exit immediately")
  .option("--persistence", "Enable task persistence", {
    default: true,
  })
  .option("--stream-output", "Stream agent output in real-time")
  .option("-v, --verbose", "Enable verbose output")
  .action(async (options: any, objective: string) => {
    // Convert Cliffy options to CommandContext format for compatibility
    const ctx = {
      args: [objective],
      flags: {
        ...options,
        "max-agents": options.maxAgents,
        "max-depth": options.maxDepth,
        "memory-namespace": options.memoryNamespace,
        "dry-run": options.dryRun,
        "quality-threshold": options.qualityThreshold,
        "no-wait": options.noWait,
        "stream-output": options.streamOutput,
      },
    };

    try {
      await swarmAction(ctx as any);
    } catch (error) {
      console.error(colors.red("Swarm execution failed:"), error.message);
      Deno.exit(1);
    }
  });
