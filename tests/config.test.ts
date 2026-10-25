import {describe, expect, it} from "vitest";
import {loadConfig} from "../src/config.js";

const baseEnv = {
  DATABASE_URL: "postgresql://postgres.example:replace-me@db.example.supabase.co:5432/postgres?sslmode=require",
  WORKER_ID: "agentic-worker-01",
  WORKSPACE_ID: "00000000-0000-4000-8000-000000000001",
  AGENT_PROVIDER: "fixture",
  SOURCE_HOST_ALLOWLIST: "supabase.com"
};

describe("configuration", () => {
  it("keeps the crash rehearsal disabled by default", () => {
    expect(loadConfig(baseEnv).REHEARSAL_CRASH_AFTER_LEASE).toBe(false);
  });

  it("rejects the crash rehearsal with a paid provider", () => {
    expect(() => loadConfig({
      ...baseEnv,
      AGENT_PROVIDER: "opencode-go",
      OPENCODE_GO_API_KEY: "oc_sk_test_not_a_real_secret",
      OPENCODE_GO_MODEL: "model-from-current-catalog",
      REHEARSAL_CRASH_AFTER_LEASE: "true"
    })).toThrow(/crash rehearsal/u);
  });
});
