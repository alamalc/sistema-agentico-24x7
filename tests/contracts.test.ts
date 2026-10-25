import {describe, expect, it} from "vitest";
import {researchTaskSchema} from "../src/contracts.js";

describe("researchTaskSchema", () => {
  it("accepts the UTC ISO-8601 representation returned by the repository", () => {
    const task = researchTaskSchema.parse({
      id: "00000000-0000-4000-8000-000000000011",
      workspaceId: "00000000-0000-4000-8000-000000000001",
      idempotencyKey: "tutorial-rootless-2026-10-24-v1",
      objective: "Contrastar un despliegue rootless con una cola durable.",
      sourceUrls: ["https://supabase.com/docs/guides/queues"],
      constraints: ["No ejecutar cambios remotos"],
      maxSteps: 6,
      maxOutputTokens: 2000,
      deadlineAt: "2026-12-31T23:59:59.000Z",
      status: "PENDING",
      attempts: 0,
      revision: 1
    });

    expect(task.deadlineAt).toBe("2026-12-31T23:59:59.000Z");
  });

  it("rejects PostgreSQL's display format at the domain boundary", () => {
    expect(() => researchTaskSchema.parse({
      id: "00000000-0000-4000-8000-000000000011",
      workspaceId: "00000000-0000-4000-8000-000000000001",
      idempotencyKey: "tutorial-rootless-2026-10-24-v1",
      objective: "Contrastar un despliegue rootless con una cola durable.",
      sourceUrls: ["https://supabase.com/docs/guides/queues"],
      constraints: ["No ejecutar cambios remotos"],
      maxSteps: 6,
      maxOutputTokens: 2000,
      deadlineAt: "2026-12-31 23:59:59-03",
      status: "PENDING",
      attempts: 0,
      revision: 1
    })).toThrow();
  });
});
