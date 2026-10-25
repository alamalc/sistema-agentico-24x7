import {loadConfig} from "./config.js";
import type {BriefProvider} from "./contracts.js";
import {FixtureProvider} from "./providers/fixture.js";
import {OpenCodeGoProvider} from "./providers/opencode-go.js";
import {AgentRepository, createPool} from "./repository.js";
import {readSource} from "./source-reader.js";

function providerFor(config: ReturnType<typeof loadConfig>): BriefProvider {
  if (config.AGENT_PROVIDER === "fixture") return new FixtureProvider();
  return new OpenCodeGoProvider({
    apiKey: config.OPENCODE_GO_API_KEY!,
    model: config.OPENCODE_GO_MODEL!,
    baseUrl: config.OPENCODE_GO_BASE_URL
  });
}

export async function runOne(): Promise<"IDLE" | "SUCCEEDED" | "BLOCKED"> {
  const config = loadConfig();
  const repository = new AgentRepository(createPool(config.DATABASE_URL), config.WORKSPACE_ID);
  try {
    const lease = await repository.lease(config.WORKER_ID, config.LEASE_SECONDS);
    if (!lease) return "IDLE";
    if (config.REHEARSAL_CRASH_AFTER_LEASE) {
      throw new Error("REHEARSAL_CRASH_AFTER_LEASE");
    }
    try {
      const sources = [];
      for (const url of lease.task.sourceUrls) {
        if (sources.length >= lease.task.maxSteps) throw new Error("STEP_BUDGET_EXCEEDED");
        sources.push(await readSource(url, config.sourceHostAllowlist, config.MAX_SOURCE_BYTES));
      }
      const provider = providerFor(config);
      const artifact = await provider.createBrief({
        sessionId: lease.sessionId,
        objective: lease.task.objective,
        constraints: lease.task.constraints,
        sources,
        maxOutputTokens: lease.task.maxOutputTokens
      });
      await repository.complete(lease, provider.id, artifact);
      return "SUCCEEDED";
    } catch (error) {
      await repository.block(lease, error);
      return "BLOCKED";
    }
  } finally {
    await repository.close();
  }
}

async function main(): Promise<void> {
  const once = process.argv.includes("--once");
  const config = loadConfig();
  do {
    const result = await runOne();
    process.stdout.write(`${new Date().toISOString()} ${result}\n`);
    if (once) return;
    await new Promise((resolve) => setTimeout(resolve, result === "IDLE" ? config.POLL_INTERVAL_MS : 100));
  } while (true);
}

if (import.meta.url === `file://${process.argv[1]?.replaceAll("\\", "/")}`) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "UNHANDLED_ERROR";
    process.stderr.write(`${new Date().toISOString()} FATAL ${message}\n`);
    process.exitCode = 1;
  });
}
