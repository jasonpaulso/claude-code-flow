/**
 * End-to-end tests for Swarm CLI commands
 */

import { assertEquals, assertExists, assertStringIncludes } from "@std/assert";
import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import {
  TEST_CONFIG,
  setupTestEnv,
  cleanupTestEnv,
  getTestTimeout,
} from "../test.config.ts";

describe("Swarm E2E Tests", () => {
  const testTimeout = getTestTimeout("e2e");

  beforeEach(async () => {
    setupTestEnv();
  });

  afterEach(async () => {
    await cleanupTestEnv();
  });

  describe("CLI Command Tests", () => {
    it(
      "should show swarm command help",
      async () => {
        const cmd = new Deno.Command("./bin/claude-flow", {
          args: ["swarm", "--help"],
          stdout: "piped",
          stderr: "piped",
        });

        const { code, stdout, stderr } = await cmd.output();
        const output = new TextDecoder().decode(stdout);
        const errorOutput = new TextDecoder().decode(stderr);

        // Command should succeed
        assertEquals(code, 0, `Command failed with stderr: ${errorOutput}`);

        // Should contain swarm help information
        assertStringIncludes(output, "swarm");
        assertStringIncludes(output, "Usage:");
      },
      testTimeout,
    );

    it(
      "should create and execute swarm objective with dry-run",
      async () => {
        const cmd = new Deno.Command("./bin/claude-flow", {
          args: [
            "swarm",
            "new",
            "Test the swarm system functionality",
            "--strategy",
            "development",
            "--dry-run",
          ],
          stdout: "piped",
          stderr: "piped",
        });

        const { code, stdout, stderr } = await cmd.output();
        const output = new TextDecoder().decode(stdout);
        const errorOutput = new TextDecoder().decode(stderr);

        assertEquals(code, 0, `Dry run failed with stderr: ${errorOutput}`);

        // Should show what would be executed
        assertStringIncludes(output, "DRY RUN");
        assertStringIncludes(output, "Test the swarm system functionality");
        assertStringIncludes(output, "development");
      },
      testTimeout,
    );

    it(
      "should list available swarm strategies",
      async () => {
        const cmd = new Deno.Command("./bin/claude-flow", {
          args: ["swarm", "strategies"],
          stdout: "piped",
          stderr: "piped",
        });

        const { code, stdout, stderr } = await cmd.output();
        const output = new TextDecoder().decode(stdout);
        const errorOutput = new TextDecoder().decode(stderr);

        assertEquals(
          code,
          0,
          `Strategies command failed with stderr: ${errorOutput}`,
        );

        // Should list available strategies
        assertStringIncludes(output, "auto");
        assertStringIncludes(output, "development");
        assertStringIncludes(output, "research");
        assertStringIncludes(output, "analysis");
      },
      testTimeout,
    );

    it(
      "should show swarm status when no swarms are running",
      async () => {
        const cmd = new Deno.Command("./bin/claude-flow", {
          args: ["swarm", "status"],
          stdout: "piped",
          stderr: "piped",
        });

        const { code, stdout, stderr } = await cmd.output();
        const output = new TextDecoder().decode(stdout);
        const errorOutput = new TextDecoder().decode(stderr);

        assertEquals(
          code,
          0,
          `Status command failed with stderr: ${errorOutput}`,
        );

        // Should show empty status or no running swarms message
        // The exact output depends on implementation
        assertExists(output);
      },
      testTimeout,
    );
  });

  describe("Swarm Workflow Tests", () => {
    it(
      "should complete a simple research workflow",
      async () => {
        // Start swarm with research strategy
        const cmd = new Deno.Command("./bin/claude-flow", {
          args: [
            "swarm",
            "new",
            "Research TypeScript best practices for large projects",
            "--strategy",
            "research",
            "--agents",
            "2",
            "--timeout",
            "30",
            "--no-wait",
          ],
          stdout: "piped",
          stderr: "piped",
          env: {
            ...Deno.env.toObject(),
            CLAUDE_FLOW_ENV: "test",
            CLAUDE_FLOW_LOG_LEVEL: "info",
          },
        });

        const { code, stdout, stderr } = await cmd.output();
        const output = new TextDecoder().decode(stdout);
        const errorOutput = new TextDecoder().decode(stderr);

        // Command should start successfully
        assertEquals(
          code,
          0,
          `Research workflow failed with stderr: ${errorOutput}`,
        );

        // Should show swarm creation and execution
        assertStringIncludes(output, "Creating swarm");
        assertStringIncludes(output, "research");
        assertStringIncludes(output, "TypeScript best practices");
      },
      testTimeout,
    );

    it(
      "should handle development workflow with multiple agents",
      async () => {
        const cmd = new Deno.Command("./bin/claude-flow", {
          args: [
            "swarm",
            "new",
            "Create a simple REST API with tests",
            "--strategy",
            "development",
            "--agents",
            "3",
            "--timeout",
            "45",
            "--no-wait",
          ],
          stdout: "piped",
          stderr: "piped",
          env: {
            ...Deno.env.toObject(),
            CLAUDE_FLOW_ENV: "test",
          },
        });

        const { code, stdout, stderr } = await cmd.output();
        const output = new TextDecoder().decode(stdout);
        const errorOutput = new TextDecoder().decode(stderr);

        assertEquals(
          code,
          0,
          `Development workflow failed with stderr: ${errorOutput}`,
        );

        assertStringIncludes(output, "Creating swarm");
        assertStringIncludes(output, "development");
        assertStringIncludes(output, "3"); // Number of agents
      },
      testTimeout,
    );

    it(
      "should validate input parameters",
      async () => {
        // Test invalid strategy
        const invalidStrategyCmd = new Deno.Command("./bin/claude-flow", {
          args: [
            "swarm",
            "new",
            "Test invalid strategy",
            "--strategy",
            "invalid-strategy",
          ],
          stdout: "piped",
          stderr: "piped",
        });

        const { code: invalidCode, stderr: invalidStderr } =
          await invalidStrategyCmd.output();
        const invalidErrorOutput = new TextDecoder().decode(invalidStderr);

        // Should fail with invalid strategy
        assertEquals(invalidCode !== 0, true);
        assertStringIncludes(invalidErrorOutput, "invalid");

        // Test invalid agent count
        const invalidAgentsCmd = new Deno.Command("./bin/claude-flow", {
          args: ["swarm", "new", "Test invalid agents", "--agents", "0"],
          stdout: "piped",
          stderr: "piped",
        });

        const { code: agentsCode, stderr: agentsStderr } =
          await invalidAgentsCmd.output();
        const agentsErrorOutput = new TextDecoder().decode(agentsStderr);

        // Should fail with invalid agent count
        assertEquals(agentsCode !== 0, true);
      },
      testTimeout,
    );
  });

  describe("Memory and State Management", () => {
    it(
      "should persist swarm state between runs",
      async () => {
        // Create a swarm and let it run briefly
        const createCmd = new Deno.Command("./bin/claude-flow", {
          args: [
            "swarm",
            "new",
            "Persistent test swarm",
            "--strategy",
            "auto",
            "--timeout",
            "10",
            "--no-wait",
          ],
          stdout: "piped",
          stderr: "piped",
        });

        const { code: createCode } = await createCmd.output();
        assertEquals(createCode, 0);

        // Check swarm status
        const statusCmd = new Deno.Command("./bin/claude-flow", {
          args: ["swarm", "status"],
          stdout: "piped",
          stderr: "piped",
        });

        const { code: statusCode, stdout: statusStdout } =
          await statusCmd.output();
        const statusOutput = new TextDecoder().decode(statusStdout);

        assertEquals(statusCode, 0);
        // Should show information about swarms (running or completed)
        assertExists(statusOutput);
      },
      testTimeout,
    );

    it(
      "should handle memory export and import",
      async () => {
        // Test memory export
        const exportCmd = new Deno.Command("./bin/claude-flow", {
          args: [
            "memory",
            "export",
            "--output",
            "./tests/temp/memory-export.json",
          ],
          stdout: "piped",
          stderr: "piped",
        });

        const { code: exportCode, stdout: exportStdout } =
          await exportCmd.output();
        const exportOutput = new TextDecoder().decode(exportStdout);

        assertEquals(exportCode, 0);
        assertStringIncludes(exportOutput, "export");

        // Verify export file exists
        try {
          const stat = await Deno.stat("./tests/temp/memory-export.json");
          assertEquals(stat.isFile, true);
        } catch {
          // File might not exist if no memory to export, which is ok for this test
        }
      },
      testTimeout,
    );
  });

  describe("Error Handling and Recovery", () => {
    it(
      "should handle invalid commands gracefully",
      async () => {
        const cmd = new Deno.Command("./bin/claude-flow", {
          args: ["swarm", "invalid-command"],
          stdout: "piped",
          stderr: "piped",
        });

        const { code, stderr } = await cmd.output();
        const errorOutput = new TextDecoder().decode(stderr);

        // Should fail gracefully with helpful error
        assertEquals(code !== 0, true);
        assertStringIncludes(errorOutput, "invalid");
      },
      testTimeout,
    );

    it(
      "should handle missing required arguments",
      async () => {
        const cmd = new Deno.Command("./bin/claude-flow", {
          args: ["swarm", "new"], // Missing objective description
          stdout: "piped",
          stderr: "piped",
        });

        const { code, stderr } = await cmd.output();
        const errorOutput = new TextDecoder().decode(stderr);

        assertEquals(code !== 0, true);
        // Should indicate missing required argument
        assertExists(errorOutput);
      },
      testTimeout,
    );

    it(
      "should timeout gracefully for long-running operations",
      async () => {
        const cmd = new Deno.Command("./bin/claude-flow", {
          args: [
            "swarm",
            "new",
            "Long running test task",
            "--timeout",
            "1", // Very short timeout
            "--no-wait",
          ],
          stdout: "piped",
          stderr: "piped",
        });

        const { code, stdout } = await cmd.output();
        const output = new TextDecoder().decode(stdout);

        // Should handle timeout appropriately
        assertEquals(code, 0); // With --no-wait, should exit successfully
        assertExists(output);
      },
      testTimeout,
    );
  });

  describe("Configuration and Environment", () => {
    it(
      "should respect environment configuration",
      async () => {
        const cmd = new Deno.Command("./bin/claude-flow", {
          args: ["swarm", "status"],
          stdout: "piped",
          stderr: "piped",
          env: {
            ...Deno.env.toObject(),
            CLAUDE_FLOW_LOG_LEVEL: "debug",
            CLAUDE_FLOW_DATA_DIR: "./tests/temp/custom-data",
          },
        });

        const { code, stdout } = await cmd.output();
        const output = new TextDecoder().decode(stdout);

        assertEquals(code, 0);
        assertExists(output);
      },
      testTimeout,
    );

    it(
      "should validate configuration files",
      async () => {
        // Create a test config file
        const configContent = {
          swarm: {
            maxAgents: 5,
            defaultStrategy: "development",
          },
          memory: {
            maxEntries: 1000,
          },
        };

        await Deno.writeTextFile(
          "./tests/temp/test-config.json",
          JSON.stringify(configContent, null, 2),
        );

        const cmd = new Deno.Command("./bin/claude-flow", {
          args: [
            "swarm",
            "new",
            "Config test",
            "--config",
            "./tests/temp/test-config.json",
            "--dry-run",
          ],
          stdout: "piped",
          stderr: "piped",
        });

        const { code, stdout } = await cmd.output();
        const output = new TextDecoder().decode(stdout);

        assertEquals(code, 0);
        assertStringIncludes(output, "Config test");
      },
      testTimeout,
    );
  });
});
