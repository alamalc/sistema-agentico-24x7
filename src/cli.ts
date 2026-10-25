import {readFile} from "node:fs/promises";
import {loadConfig} from "./config.js";
import {AgentRepository, createPool} from "./repository.js";

interface TaskFile {
  objective: string;
  sourceUrls: string[];
  constraints?: string[];
  maxSteps?: number;
  maxOutputTokens?: number;
  deadlineAt: string;
  idempotencyKey: string;
}

async function main(): Promise<void> {
  const config = loadConfig();
  const repository = new AgentRepository(createPool(config.DATABASE_URL), config.WORKSPACE_ID);
  try {
    const command = process.argv[2];
    if (command === "health") {
      await repository.health();
      process.stdout.write("PASS database reachable\n");
      return;
    }
    if (command === "enqueue") {
      const file = process.argv[3];
      if (!file) throw new Error("Usage: npm run cli -- enqueue task.json");
      const input = JSON.parse(await readFile(file, "utf8")) as TaskFile;
      const result = await repository.enqueue({
        objective: input.objective,
        sourceUrls: input.sourceUrls,
        constraints: input.constraints ?? [],
        maxSteps: input.maxSteps ?? 8,
        maxOutputTokens: input.maxOutputTokens ?? 2_000,
        deadlineAt: input.deadlineAt,
        idempotencyKey: input.idempotencyKey
      });
      process.stdout.write(`${result.created ? "CREATED" : "EXISTS"} ${result.taskId}\n`);
      return;
    }
    throw new Error("Usage: npm run cli -- <health|enqueue task.json>");
  } finally {
    await repository.close();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : "CLI_FAILED"}\n`);
  process.exitCode = 1;
});
