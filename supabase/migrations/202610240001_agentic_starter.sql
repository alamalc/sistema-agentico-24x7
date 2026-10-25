create extension if not exists pgmq;

do $$
begin
  if not exists (
    select 1
    from pgmq.list_queues()
    where queue_name = 'agent_jobs'
  ) then
    perform pgmq.create('agent_jobs');
  end if;
end
$$;

create table if not exists public.agent_tasks (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  idempotency_key text not null check (length(idempotency_key) between 8 and 200),
  objective text not null check (length(objective) between 20 and 2000),
  source_urls jsonb not null check (jsonb_typeof(source_urls) = 'array' and jsonb_array_length(source_urls) between 1 and 12),
  constraints jsonb not null default '[]'::jsonb check (jsonb_typeof(constraints) = 'array'),
  status text not null default 'PENDING' check (status in ('PENDING','RUNNING','SUCCEEDED','BLOCKED','RECONCILING','CANCELLED')),
  max_steps smallint not null default 8 check (max_steps between 1 and 12),
  max_output_tokens integer not null default 2000 check (max_output_tokens between 256 and 8000),
  deadline_at timestamptz not null,
  attempts integer not null default 0 check (attempts >= 0),
  revision integer not null default 1 check (revision > 0),
  leased_by text,
  lease_expires_at timestamptz,
  last_error_code text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, idempotency_key),
  unique (id, workspace_id)
);

create table if not exists public.agent_runs (
  id uuid primary key,
  workspace_id uuid not null,
  task_id uuid not null,
  session_id text not null,
  provider text not null,
  model text,
  status text not null check (status in ('RUNNING','SUCCEEDED','BLOCKED','RECONCILING')),
  error_code text,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (task_id, session_id),
  foreign key (task_id, workspace_id)
    references public.agent_tasks(id, workspace_id) on delete cascade
);

create table if not exists public.agent_events (
  id uuid primary key,
  workspace_id uuid not null,
  task_id uuid not null,
  run_id uuid references public.agent_runs(id) on delete cascade,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  occurred_at timestamptz not null default now(),
  foreign key (task_id, workspace_id)
    references public.agent_tasks(id, workspace_id) on delete cascade
);

create table if not exists public.agent_artifacts (
  id uuid primary key,
  workspace_id uuid not null,
  task_id uuid not null,
  run_id uuid not null references public.agent_runs(id) on delete cascade,
  kind text not null,
  body jsonb not null check (jsonb_typeof(body) = 'object'),
  sha256 char(64) not null check (sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  unique (task_id, kind),
  foreign key (task_id, workspace_id)
    references public.agent_tasks(id, workspace_id) on delete cascade
);

create table if not exists public.agent_approvals (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  task_id uuid not null,
  scope text not null check (scope in ('EXECUTE_ONCE','EXTERNAL_WRITE_ONCE')),
  approved_by uuid not null,
  payload_sha256 char(64) not null check (payload_sha256 ~ '^[0-9a-f]{64}$'),
  valid_until timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (task_id, workspace_id)
    references public.agent_tasks(id, workspace_id) on delete cascade
);

create index if not exists agent_tasks_ready_idx on public.agent_tasks(status, deadline_at, created_at);
create index if not exists agent_tasks_workspace_idx on public.agent_tasks(workspace_id);
create index if not exists agent_runs_workspace_idx on public.agent_runs(workspace_id, started_at);
create index if not exists agent_events_task_idx on public.agent_events(task_id, occurred_at);
create index if not exists agent_events_workspace_idx on public.agent_events(workspace_id, occurred_at);
create index if not exists agent_artifacts_workspace_idx on public.agent_artifacts(workspace_id, created_at);
create index if not exists agent_approvals_workspace_idx on public.agent_approvals(workspace_id, created_at);

alter table public.agent_tasks enable row level security;
alter table public.agent_runs enable row level security;
alter table public.agent_events enable row level security;
alter table public.agent_artifacts enable row level security;
alter table public.agent_approvals enable row level security;

revoke all on public.agent_tasks, public.agent_runs, public.agent_events, public.agent_artifacts, public.agent_approvals from anon, authenticated;
grant select, insert on public.agent_tasks to authenticated;
grant select on public.agent_runs, public.agent_events, public.agent_artifacts to authenticated;
grant select, insert on public.agent_approvals to authenticated;

create policy "workspace users can read tasks"
  on public.agent_tasks for select to authenticated
  using (workspace_id::text = (select auth.jwt() -> 'app_metadata' ->> 'workspace_id'));

create policy "workspace users can propose tasks"
  on public.agent_tasks for insert to authenticated
  with check (
    workspace_id::text = (select auth.jwt() -> 'app_metadata' ->> 'workspace_id')
    and created_by = (select auth.uid())
    and status = 'PENDING'
    and attempts = 0
  );

create policy "workspace users can read runs"
  on public.agent_runs for select to authenticated
  using (workspace_id::text = (select auth.jwt() -> 'app_metadata' ->> 'workspace_id'));

create policy "workspace users can read events"
  on public.agent_events for select to authenticated
  using (workspace_id::text = (select auth.jwt() -> 'app_metadata' ->> 'workspace_id'));

create policy "workspace users can read artifacts"
  on public.agent_artifacts for select to authenticated
  using (workspace_id::text = (select auth.jwt() -> 'app_metadata' ->> 'workspace_id'));

create policy "workspace users can read approvals"
  on public.agent_approvals for select to authenticated
  using (workspace_id::text = (select auth.jwt() -> 'app_metadata' ->> 'workspace_id'));

create policy "workspace users can approve exact payloads"
  on public.agent_approvals for insert to authenticated
  with check (
    workspace_id::text = (select auth.jwt() -> 'app_metadata' ->> 'workspace_id')
    and approved_by = (select auth.uid())
    and valid_until > now()
    and consumed_at is null
  );

comment on table public.agent_tasks is 'Canonical tasks. The queue transports task IDs only.';
comment on table public.agent_approvals is 'Human approvals bound to one payload hash and expiry.';
