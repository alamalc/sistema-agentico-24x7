import {technicalBriefSchema, type BriefProvider, type ProviderRequest, type TechnicalBrief} from "../contracts.js";

interface OpenCodeGoOptions {
  apiKey: string;
  model: string;
  baseUrl: string;
  fetchImpl?: typeof fetch;
}

function extractJson(value: string): unknown {
  const trimmed = value.trim().replace(/^```json\s*/u, "").replace(/\s*```$/u, "");
  return JSON.parse(trimmed) as unknown;
}

export class OpenCodeGoProvider implements BriefProvider {
  readonly id: string;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: OpenCodeGoOptions) {
    this.id = `opencode-go:${options.model}`;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async createBrief(request: ProviderRequest): Promise<TechnicalBrief> {
    const sourceBundle = request.sources.map((source, index) => ({
      source: index + 1,
      url: source.url,
      retrievedAt: source.retrievedAt,
      sha256: source.sha256,
      text: source.text.slice(0, 30_000)
    }));
    const prompt = [
      "Actúa como asistente de ingeniería. Prepara un brief técnico verificable a partir de fuentes suministradas.",
      "No inventes hechos. Cada hallazgo debe citar una o más URL suministradas.",
      `Objetivo: ${request.objective}`,
      `Restricciones: ${JSON.stringify(request.constraints)}`,
      `Fuentes: ${JSON.stringify(sourceBundle)}`,
      "Devuelve exclusivamente JSON con: title, summary, findings[{claim,sourceUrls,confidence}], implementationSteps, risks, unresolvedQuestions."
    ].join("\n\n");
    const response = await this.fetchImpl(`${this.options.baseUrl.replace(/\/$/u, "")}/chat/completions`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.options.apiKey}`,
        "content-type": "application/json",
        "user-agent": "sistema-agentico-24x7/1.0",
        "x-opencode-session": request.sessionId
      },
      body: JSON.stringify({
        model: this.options.model,
        temperature: 0.1,
        max_tokens: request.maxOutputTokens,
        messages: [{role: "user", content: prompt}]
      }),
      signal: AbortSignal.timeout(60_000)
    });
    if (!response.ok) throw new Error(`OPENCODE_GO_HTTP_${response.status}`);
    const payload = await response.json() as {choices?: Array<{message?: {content?: string}}>};
    const content = payload.choices?.[0]?.message?.content;
    if (!content) throw new Error("OPENCODE_GO_EMPTY_RESPONSE");
    return technicalBriefSchema.parse(extractJson(content));
  }
}
