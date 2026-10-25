import {z} from "zod";

export const taskStatusSchema = z.enum([
  "PENDING",
  "RUNNING",
  "SUCCEEDED",
  "BLOCKED",
  "RECONCILING",
  "CANCELLED"
]);

export const researchTaskSchema = z.object({
  id: z.string().uuid(),
  workspaceId: z.string().uuid(),
  idempotencyKey: z.string().min(8).max(200),
  objective: z.string().trim().min(20).max(2_000),
  sourceUrls: z.array(z.string().url()).min(1).max(12),
  constraints: z.array(z.string().trim().min(3).max(500)).max(20),
  maxSteps: z.number().int().min(1).max(12),
  maxOutputTokens: z.number().int().min(256).max(8_000),
  deadlineAt: z.string().datetime({offset: true}),
  status: taskStatusSchema,
  attempts: z.number().int().nonnegative(),
  revision: z.number().int().positive()
});

export type ResearchTask = z.infer<typeof researchTaskSchema>;

export const sourceDocumentSchema = z.object({
  url: z.string().url(),
  title: z.string().trim().min(1).max(500),
  retrievedAt: z.string().datetime({offset: true}),
  contentType: z.string().max(200),
  text: z.string().min(1).max(200_000),
  sha256: z.string().regex(/^[0-9a-f]{64}$/u)
});

export type SourceDocument = z.infer<typeof sourceDocumentSchema>;

export const technicalBriefSchema = z.object({
  title: z.string().trim().min(5).max(240),
  summary: z.string().trim().min(40).max(4_000),
  findings: z.array(z.object({
    claim: z.string().trim().min(10).max(1_000),
    sourceUrls: z.array(z.string().url()).min(1).max(5),
    confidence: z.enum(["high", "medium", "low"])
  })).min(1).max(20),
  implementationSteps: z.array(z.string().trim().min(5).max(1_000)).min(1).max(20),
  risks: z.array(z.string().trim().min(5).max(1_000)).max(20),
  unresolvedQuestions: z.array(z.string().trim().min(5).max(1_000)).max(20)
});

export type TechnicalBrief = z.infer<typeof technicalBriefSchema>;

export interface ProviderRequest {
  sessionId: string;
  objective: string;
  constraints: readonly string[];
  sources: readonly SourceDocument[];
  maxOutputTokens: number;
}

export interface BriefProvider {
  readonly id: string;
  createBrief(request: ProviderRequest): Promise<TechnicalBrief>;
}
