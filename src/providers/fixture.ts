import type {BriefProvider, ProviderRequest, TechnicalBrief} from "../contracts.js";

export class FixtureProvider implements BriefProvider {
  readonly id = "fixture:v1";

  async createBrief(request: ProviderRequest): Promise<TechnicalBrief> {
    const first = request.sources[0];
    if (!first) throw new Error("FIXTURE_REQUIRES_SOURCE");
    return {
      title: `Brief técnico: ${request.objective.slice(0, 120)}`,
      summary: "Resultado determinista para comprobar cola, lease, evidencia, artefactos e idempotencia sin enviar datos a un proveedor externo.",
      findings: [{
        claim: `La fuente principal fue recuperada y fijada con SHA-256 ${first.sha256}.`,
        sourceUrls: [first.url],
        confidence: "high"
      }],
      implementationSteps: [
        "Revisar el documento recuperado y su fecha.",
        "Validar el resultado contra el contrato de salida.",
        "Aprobar cualquier efecto externo en una etapa separada."
      ],
      risks: ["El fixture demuestra la tubería, no la calidad de un modelo."],
      unresolvedQuestions: request.constraints.length === 0 ? ["Definir restricciones específicas antes de producción."] : []
    };
  }
}
