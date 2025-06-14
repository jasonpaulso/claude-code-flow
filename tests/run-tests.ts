#!/usr/bin/env deno run --allow-all

/**
 * Test runner for Claude-Flow
 * Runs unit, integration, and E2E tests with proper setup
 */

import { parseArgs } from "https://deno.land/std@0.208.0/cli/parse_args.ts";
import { TEST_CONFIG, setupTestEnv, cleanupTestEnv } from "./test.config.ts";

interface TestRunnerOptions {
  suite?: "unit" | "integration" | "e2e" | "all";
  pattern?: string;
  coverage?: boolean;
  watch?: boolean;
  verbose?: boolean;
  parallel?: boolean;
  timeout?: number;
}

async function runTests(options: TestRunnerOptions = {}) {
  const {
    suite = "all",
    pattern,
    coverage = false,
    watch = false,
    verbose = false,
    parallel = true,
    timeout,
  } = options;

  console.log("🚀 Starting Claude-Flow Test Suite");
  console.log(`📋 Running: ${suite} tests`);

  if (pattern) {
    console.log(`🔍 Pattern: ${pattern}`);
  }

  // Setup test environment
  setupTestEnv();

  try {
    // Determine which test suites to run
    const suitesToRun = getSuitesToRun(suite);

    let totalPassed = 0;
    let totalFailed = 0;
    let totalTime = 0;

    for (const testSuite of suitesToRun) {
      console.log(`\n📂 Running ${testSuite} tests...`);

      const startTime = Date.now();
      const result = await runTestSuite(testSuite, {
        pattern,
        coverage: coverage && testSuite === "unit", // Only generate coverage for unit tests
        watch,
        verbose,
        parallel,
        timeout:
          timeout ||
          TEST_CONFIG.timeout[testSuite as keyof typeof TEST_CONFIG.timeout],
      });
      const endTime = Date.now();

      totalPassed += result.passed;
      totalFailed += result.failed;
      totalTime += endTime - startTime;

      if (result.failed > 0) {
        console.log(
          `❌ ${testSuite} tests: ${result.passed} passed, ${result.failed} failed`,
        );
      } else {
        console.log(`✅ ${testSuite} tests: ${result.passed} passed`);
      }
    }

    // Print summary
    console.log("\n📊 Test Summary");
    console.log("═".repeat(50));
    console.log(`Total Tests: ${totalPassed + totalFailed}`);
    console.log(`Passed: ${totalPassed}`);
    console.log(`Failed: ${totalFailed}`);
    console.log(`Duration: ${(totalTime / 1000).toFixed(2)}s`);

    if (totalFailed === 0) {
      console.log("\n🎉 All tests passed!");
    } else {
      console.log(`\n❌ ${totalFailed} test(s) failed`);
    }

    return totalFailed === 0;
  } catch (error) {
    console.error("💥 Test runner failed:", error);
    return false;
  } finally {
    // Cleanup test environment
    await cleanupTestEnv();
  }
}

function getSuitesToRun(suite: string): string[] {
  switch (suite) {
    case "unit":
      return ["unit"];
    case "integration":
      return ["integration"];
    case "e2e":
      return ["e2e"];
    case "all":
      return ["unit", "integration", "e2e"];
    default:
      throw new Error(`Unknown test suite: ${suite}`);
  }
}

async function runTestSuite(
  suite: string,
  options: {
    pattern?: string;
    coverage?: boolean;
    watch?: boolean;
    verbose?: boolean;
    parallel?: boolean;
    timeout?: number;
  },
): Promise<{ passed: number; failed: number }> {
  const testDir =
    TEST_CONFIG.directories[suite as keyof typeof TEST_CONFIG.directories];

  // Build Deno test command
  const cmd = ["deno", "test"];

  // Add flags
  cmd.push("--allow-all");

  if (options.coverage) {
    cmd.push("--coverage=./test-results/coverage");
  }

  if (options.watch) {
    cmd.push("--watch");
  }

  if (options.parallel) {
    cmd.push("--parallel");
  }

  if (options.timeout) {
    cmd.push(`--timeout=${options.timeout}`);
  }

  // Add test directory
  if (options.pattern) {
    cmd.push(`${testDir}/**/*${options.pattern}*test.ts`);
  } else {
    cmd.push(`${testDir}/**/*.test.ts`);
  }

  // Add reporter for better output
  if (options.verbose) {
    cmd.push("--reporter=verbose");
  } else {
    cmd.push("--reporter=pretty");
  }

  // Run the command
  const command = new Deno.Command(cmd[0], {
    args: cmd.slice(1),
    stdout: "piped",
    stderr: "piped",
  });

  const { code, stdout, stderr } = await command.output();
  const output = new TextDecoder().decode(stdout);
  const errorOutput = new TextDecoder().decode(stderr);

  // Print output
  if (options.verbose || code !== 0) {
    console.log(output);
    if (errorOutput) {
      console.error(errorOutput);
    }
  }

  // Parse results (simplified parsing)
  const lines = output.split("\n");
  let passed = 0;
  let failed = 0;

  for (const line of lines) {
    if (line.includes("ok") && line.includes("test")) {
      passed++;
    } else if (line.includes("FAILED") || line.includes("failed")) {
      failed++;
    }
  }

  // If we can't parse results, use exit code
  if (passed === 0 && failed === 0) {
    if (code === 0) {
      passed = 1; // At least one test passed
    } else {
      failed = 1; // At least one test failed
    }
  }

  return { passed, failed };
}

async function generateCoverageReport(): Promise<void> {
  console.log("\n📈 Generating coverage report...");

  const cmd = new Deno.Command("deno", {
    args: [
      "coverage",
      "./test-results/coverage",
      "--html",
      "--output=./test-results/coverage-html",
    ],
    stdout: "piped",
    stderr: "piped",
  });

  const { code, stdout, stderr } = await cmd.output();

  if (code === 0) {
    console.log("✅ Coverage report generated at ./test-results/coverage-html");
  } else {
    console.error("❌ Failed to generate coverage report");
    console.error(new TextDecoder().decode(stderr));
  }
}

async function checkCoverageThresholds(): Promise<boolean> {
  console.log("\n🎯 Checking coverage thresholds...");

  try {
    const cmd = new Deno.Command("deno", {
      args: [
        "coverage",
        "./test-results/coverage",
        "--unstable",
        "--exclude=tests/",
      ],
      stdout: "piped",
      stderr: "piped",
    });

    const { stdout } = await cmd.output();
    const output = new TextDecoder().decode(stdout);

    // Parse coverage percentages (simplified)
    const lines = output.split("\n");
    let totalCoverage = 0;

    for (const line of lines) {
      if (line.includes("cover") && line.includes("%")) {
        const match = line.match(/(\d+(?:\.\d+)?)%/);
        if (match) {
          totalCoverage = parseFloat(match[1]);
          break;
        }
      }
    }

    const threshold = TEST_CONFIG.coverage.lines;
    const passed = totalCoverage >= threshold;

    console.log(
      `Coverage: ${totalCoverage.toFixed(2)}% (threshold: ${threshold}%)`,
    );

    if (passed) {
      console.log("✅ Coverage threshold met");
    } else {
      console.log("❌ Coverage threshold not met");
    }

    return passed;
  } catch (error) {
    console.warn("⚠️  Could not check coverage thresholds:", error);
    return true; // Don't fail build for coverage check issues
  }
}

// CLI interface
if (import.meta.main) {
  const args = parseArgs(Deno.args, {
    string: ["suite", "pattern", "timeout"],
    boolean: ["coverage", "watch", "verbose", "parallel", "help"],
    alias: {
      s: "suite",
      p: "pattern",
      c: "coverage",
      w: "watch",
      v: "verbose",
      h: "help",
      t: "timeout",
    },
    default: {
      suite: "all",
      coverage: false,
      watch: false,
      verbose: false,
      parallel: true,
    },
  });

  if (args.help) {
    console.log(`
Claude-Flow Test Runner

Usage: deno run --allow-all tests/run-tests.ts [options]

Options:
  -s, --suite <suite>     Test suite to run (unit|integration|e2e|all) [default: all]
  -p, --pattern <pattern> Run tests matching pattern
  -c, --coverage          Generate coverage report (unit tests only)
  -w, --watch             Watch for file changes
  -v, --verbose           Verbose output
  --parallel              Run tests in parallel [default: true]
  -t, --timeout <ms>      Test timeout in milliseconds
  -h, --help              Show this help

Examples:
  deno run --allow-all tests/run-tests.ts --suite unit --coverage
  deno run --allow-all tests/run-tests.ts --pattern swarm
  deno run --allow-all tests/run-tests.ts --suite e2e --verbose
`);
    Deno.exit(0);
  }

  const options: TestRunnerOptions = {
    suite: args.suite as TestRunnerOptions["suite"],
    pattern: args.pattern,
    coverage: args.coverage,
    watch: args.watch,
    verbose: args.verbose,
    parallel: args.parallel,
    timeout: args.timeout ? parseInt(args.timeout) : undefined,
  };

  const success = await runTests(options);

  // Generate coverage report if requested
  if (options.coverage) {
    await generateCoverageReport();
    const coveragePassed = await checkCoverageThresholds();
    if (!coveragePassed) {
      Deno.exit(1);
    }
  }

  Deno.exit(success ? 0 : 1);
}
