import {z} from "zod";

const configSchema = z.object({
  DATABASE_URL: z.string().url().refine((value) => value.startsWith("postgresql://") || value.startsWith("postgres://"), "DATABASE_URL must be PostgreSQL"),
  WORKER_ID: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u),
  WORKSPACE_ID: z.string().uuid(),
  AGENT_PROVIDER: z.enum(["fixture", "opencode-go"]).default("fixture"),
  POLL_INTERVAL_MS: z.coerce.number().int().min(1_000).max(60_000).default(5_000),
  LEASE_SECONDS: z.coerce.number().int().min(30).max(900).default(90),
  MAX_SOURCE_BYTES: z.coerce.number().int().min(10_000).max(5_000_000).default(1_000_000),
  SOURCE_HOST_ALLOWLIST: z.string().min(1),
  REHEARSAL_CRASH_AFTER_LEASE: z.enum(["false", "true"]).default("false").transform((value) => value === "true"),
  OPENCODE_GO_API_KEY: z.string().min(20).optional(),
  OPENCODE_GO_MODEL: z.string().min(2).max(100).optional(),
  OPENCODE_GO_BASE_URL: z.string().url().default("https://opencode.ai/inference/go/v1")
}).superRefine((value, context) => {
  if (value.REHEARSAL_CRASH_AFTER_LEASE && value.AGENT_PROVIDER !== "fixture") {
    context.addIssue({code: "custom", path: ["REHEARSAL_CRASH_AFTER_LEASE"], message: "The crash rehearsal is restricted to the fixture provider"});
  }
  if (value.AGENT_PROVIDER !== "opencode-go") return;
  if (!value.OPENCODE_GO_API_KEY) {
    context.addIssue({code: "custom", path: ["OPENCODE_GO_API_KEY"], message: "OpenCode Go requires an API key"});
  }
  if (!value.OPENCODE_GO_MODEL) {
    context.addIssue({code: "custom", path: ["OPENCODE_GO_MODEL"], message: "Choose a current model from the OpenCode Go catalog"});
  }
});

export type AppConfig = z.infer<typeof configSchema> & {sourceHostAllowlist: ReadonlySet<string>};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = configSchema.parse(env);
  const sourceHostAllowlist = new Set(parsed.SOURCE_HOST_ALLOWLIST.split(",").map((value) => value.trim().toLowerCase()).filter(Boolean));
  if (sourceHostAllowlist.size === 0) throw new Error("SOURCE_HOST_ALLOWLIST must contain at least one hostname");
  return {...parsed, sourceHostAllowlist};
}
