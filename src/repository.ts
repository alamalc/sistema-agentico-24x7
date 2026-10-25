import {createHash, randomUUID} from "node:crypto";
import {Pool, type PoolClient} from "pg";
import {researchTaskSchema, type ResearchTask, type TechnicalBrief} from "./contracts.js";

interface QueueMessage {
  msg_id: string;
  read_ct: number;
  message: {taskId?: string};
}

export interface LeaseResult {
  messageId: string;
  task: ResearchTask;
  runId: string;
  sessionId: string;
}

export class AgentRepository {
  constructor(private readonly pool: Pool, private readonly workspaceId: string) {}

  async health(): Promise<void> {
    const result = await this.pool.query<{ok: number}>("select 1 as ok");
    if (result.rows[0]?.ok !== 1) throw new Error("DATABASE_HEALTHCHECK_FAILED");
  }

  async enqueue(input: {
    objective: string;
    sourceUrls: readonly string[];
    constraints: readonly string[];
    maxSteps: number;
    maxOutputTokens: number;
    deadlineAt: string;
    idempotencyKey: string;
  }): Promise<{taskId: string; created: boolean}> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const taskId = randomUUID();
      const inserted = await client.query<{id: string}>(
        `insert into public.agent_tasks (
           id, workspace_id, idempotency_key, objective, source_urls, constraints,
           max_steps, max_output_tokens, deadline_at
         ) values ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,$8,$9)
         on conflict (workspace_id, idempotency_key) do nothing
         returning id`,
        [taskId, this.workspaceId, input.idempotencyKey, input.objective, JSON.stringify(input.sourceUrls), JSON.stringify(input.constraints), input.maxSteps, input.maxOutputTokens, input.deadlineAt]
      );
      if (!inserted.rows[0]) {
        const existing = await client.query<{id: string}>(
          "select id from public.agent_tasks where workspace_id = $1 and idempotency_key = $2",
          [this.workspaceId, input.idempotencyKey]
        );
        const existingTaskId = existing.rows[0]?.id;
        if (!existingTaskId) throw new Error("IDEMPOTENCY_LOOKUP_FAILED");
        await client.query("commit");
        return {taskId: existingTaskId, created: false};
      }
      await client.query("select * from pgmq.send($1, $2::jsonb)", ["agent_jobs", JSON.stringify({taskId})]);
      await client.query("commit");
      return {taskId, created: true};
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async lease(workerId: string, leaseSeconds: number): Promise<LeaseResult | null> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const queue = await client.query<QueueMessage>(
        "select msg_id::text, read_ct, message from pgmq.read($1, $2, 1)",
        ["agent_jobs", leaseSeconds]
      );
      const message = queue.rows[0];
      if (!message) {
        await client.query("commit");
        return null;
      }
      const taskId = message.message.taskId;
      if (!taskId) throw new Error("QUEUE_MESSAGE_INVALID");
      const taskResult = await client.query<Record<string, unknown>>(
        `select id, workspace_id as "workspaceId", idempotency_key as "idempotencyKey",
                objective, source_urls as "sourceUrls", constraints, max_steps as "maxSteps",
                max_output_tokens as "maxOutputTokens",
                to_char(deadline_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as "deadlineAt",
                status, attempts, revision
           from public.agent_tasks
          where id = $1 and workspace_id = $2
          for update`,
        [taskId, this.workspaceId]
      );
      const task = researchTaskSchema.parse(taskResult.rows[0]);
      if (["SUCCEEDED", "CANCELLED"].includes(task.status)) {
        await client.query("select pgmq.archive($1, $2::bigint)", ["agent_jobs", message.msg_id]);
        await client.query("commit");
        return null;
      }
      if (task.status === "RECONCILING") {
        await client.query("commit");
        return null;
      }
      if (new Date(task.deadlineAt).getTime() <= Date.now()) {
        await this.blockWithin(client, task.id, "DEADLINE_EXPIRED");
        await client.query("select pgmq.archive($1, $2::bigint)", ["agent_jobs", message.msg_id]);
        await client.query("commit");
        return null;
      }
      const runId = randomUUID();
      const sessionId = createHash("sha256").update(`${task.id}:${task.attempts + 1}`, "utf8").digest("hex").slice(0, 32);
      await client.query(
        `update public.agent_runs
            set status = 'BLOCKED', error_code = 'LEASE_EXPIRED', completed_at = now()
          where task_id = $1 and workspace_id = $2 and status = 'RUNNING'`,
        [task.id, this.workspaceId]
      );
      await client.query(
        `update public.agent_tasks
            set status = 'RUNNING', attempts = attempts + 1, revision = revision + 1,
                leased_by = $2, lease_expires_at = now() + make_interval(secs => $3), updated_at = now()
          where id = $1`,
        [task.id, workerId, leaseSeconds]
      );
      await client.query(
        `insert into public.agent_runs (id, workspace_id, task_id, session_id, provider, status)
         values ($1,$2,$3,$4,'pending','RUNNING')`,
        [runId, this.workspaceId, task.id, sessionId]
      );
      if (task.status === "RUNNING") {
        await this.eventWithin(client, task.id, runId, "LEASE_RECOVERED", {attempt: task.attempts + 1});
      }
      await client.query("commit");
      return {messageId: message.msg_id, task: {...task, status: "RUNNING", attempts: task.attempts + 1, revision: task.revision + 1}, runId, sessionId};
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async complete(lease: LeaseResult, provider: string, artifact: TechnicalBrief): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const body = JSON.stringify(artifact);
      const sha256 = createHash("sha256").update(body, "utf8").digest("hex");
      await client.query(
        `insert into public.agent_artifacts (id, workspace_id, task_id, run_id, kind, body, sha256)
         values ($1,$2,$3,$4,'technical-brief',$5::jsonb,$6)
         on conflict (task_id, kind) do nothing`,
        [randomUUID(), this.workspaceId, lease.task.id, lease.runId, body, sha256]
      );
      await client.query(
        "update public.agent_runs set provider = $2, status = 'SUCCEEDED', completed_at = now() where id = $1",
        [lease.runId, provider]
      );
      await client.query(
        `update public.agent_tasks
            set status = 'SUCCEEDED', revision = revision + 1, leased_by = null,
                lease_expires_at = null, updated_at = now()
          where id = $1 and workspace_id = $2 and status = 'RUNNING'`,
        [lease.task.id, this.workspaceId]
      );
      await client.query("select pgmq.archive($1, $2::bigint)", ["agent_jobs", lease.messageId]);
      await this.eventWithin(client, lease.task.id, lease.runId, "TASK_SUCCEEDED", {provider, artifactSha256: sha256});
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async block(lease: LeaseResult, error: unknown): Promise<void> {
    const code = error instanceof Error ? error.message.slice(0, 200) : "UNKNOWN_ERROR";
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      await this.blockWithin(client, lease.task.id, code);
      await client.query(
        "update public.agent_runs set status = 'BLOCKED', error_code = $2, completed_at = now() where id = $1",
        [lease.runId, code]
      );
      await client.query("select pgmq.archive($1, $2::bigint)", ["agent_jobs", lease.messageId]);
      await this.eventWithin(client, lease.task.id, lease.runId, "TASK_BLOCKED", {code});
      await client.query("commit");
    } catch (blockError) {
      await client.query("rollback");
      throw blockError;
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  private async blockWithin(client: PoolClient, taskId: string, code: string): Promise<void> {
    await client.query(
      `update public.agent_tasks
          set status = 'BLOCKED', last_error_code = $2, revision = revision + 1,
              leased_by = null, lease_expires_at = null, updated_at = now()
        where id = $1 and workspace_id = $3`,
      [taskId, code, this.workspaceId]
    );
  }

  private async eventWithin(client: PoolClient, taskId: string, runId: string, type: string, payload: Record<string, unknown>): Promise<void> {
    await client.query(
      `insert into public.agent_events (id, workspace_id, task_id, run_id, event_type, payload)
       values ($1,$2,$3,$4,$5,$6::jsonb)`,
      [randomUUID(), this.workspaceId, taskId, runId, type, JSON.stringify(payload)]
    );
  }
}

export function createPool(databaseUrl: string): Pool {
  return new Pool({connectionString: databaseUrl, max: 4, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 10_000});
}
