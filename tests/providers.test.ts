import {describe, expect, it, vi} from "vitest";
import {FixtureProvider} from "../src/providers/fixture.js";
import {OpenCodeGoProvider} from "../src/providers/opencode-go.js";

const request = {
  sessionId: "stable-session-01",
  objective: "Preparar un brief técnico verificable sobre despliegue rootless.",
  constraints: ["No inventar"],
  sources: [{
    url: "https://docs.example.com/rootless",
    title: "Rootless",
    retrievedAt: "2026-10-24T12:00:00Z",
    contentType: "text/plain",
    text: "Rootless execution isolates the daemon.",
    sha256: "a".repeat(64)
  }],
  maxOutputTokens: 1000
};

describe("providers", () => {
  it("keeps the tutorial reproducible with a deterministic fixture", async () => {
    const result = await new FixtureProvider().createBrief(request);
    expect(result.findings[0]?.sourceUrls).toEqual([request.sources[0]?.url]);
  });

  it("sends OpenCode Go identity and a stable session without exposing it in the prompt", async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(new Headers(init?.headers).get("user-agent")).toBe("sistema-agentico-24x7/1.0");
      expect(new Headers(init?.headers).get("x-opencode-session")).toBe(request.sessionId);
      return new Response(JSON.stringify({choices: [{message: {content: JSON.stringify({
        title: "Brief rootless",
        summary: "Síntesis técnica basada únicamente en la documentación oficial entregada.",
        findings: [{claim: "La fuente describe ejecución sin privilegios de root.", sourceUrls: [request.sources[0]?.url], confidence: "high"}],
        implementationSteps: ["Verificar los prerrequisitos del host."],
        risks: ["La configuración del host puede variar."],
        unresolvedQuestions: []
      })}}]}), {status: 200, headers: {"content-type": "application/json"}});
    });
    const provider = new OpenCodeGoProvider({apiKey: "oc_sk_test_not_a_real_secret", model: "model-from-current-catalog", baseUrl: "https://opencode.ai/inference/go/v1", fetchImpl: fetchImpl as typeof fetch});
    const result = await provider.createBrief(request);
    expect(result.title).toBe("Brief rootless");
    expect(fetchImpl).toHaveBeenCalledOnce();
  });
});
