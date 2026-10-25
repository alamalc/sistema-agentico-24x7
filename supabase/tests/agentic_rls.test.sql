begin;
select plan(28);

select has_table('public', 'agent_tasks', 'agent_tasks exists');
select has_table('public', 'agent_runs', 'agent_runs exists');
select has_table('public', 'agent_events', 'agent_events exists');
select has_table('public', 'agent_artifacts', 'agent_artifacts exists');
select has_table('public', 'agent_approvals', 'agent_approvals exists');

select is((select relrowsecurity from pg_class where oid = 'public.agent_tasks'::regclass), true, 'agent_tasks has RLS enabled');
select is((select relrowsecurity from pg_class where oid = 'public.agent_runs'::regclass), true, 'agent_runs has RLS enabled');
select is((select relrowsecurity from pg_class where oid = 'public.agent_events'::regclass), true, 'agent_events has RLS enabled');
select is((select relrowsecurity from pg_class where oid = 'public.agent_artifacts'::regclass), true, 'agent_artifacts has RLS enabled');
select is((select relrowsecurity from pg_class where oid = 'public.agent_approvals'::regclass), true, 'agent_approvals has RLS enabled');

select isnt(has_table_privilege('anon', 'public.agent_tasks', 'select'), true, 'anon cannot read tasks');
select isnt(has_table_privilege('anon', 'public.agent_tasks', 'insert'), true, 'anon cannot insert tasks');
select is(has_table_privilege('authenticated', 'public.agent_tasks', 'select'), true, 'authenticated may select tasks through RLS');
select is(has_table_privilege('authenticated', 'public.agent_tasks', 'insert'), true, 'authenticated may propose tasks through RLS');

insert into public.agent_tasks (
  id, workspace_id, idempotency_key, objective, source_urls, constraints,
  deadline_at, created_by
) values (
  '10000000-0000-4000-8000-000000000002',
  '20000000-0000-4000-8000-000000000002',
  'fixture-other-workspace',
  'Tarea canónica de otro espacio para probar aislamiento.',
  '["https://supabase.com/docs/guides/queues"]'::jsonb,
  '[]'::jsonb,
  now() + interval '1 hour',
  '30000000-0000-4000-8000-000000000002'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"30000000-0000-4000-8000-000000000001","role":"authenticated","app_metadata":{"workspace_id":"20000000-0000-4000-8000-000000000001"}}',
  true
);
set local role authenticated;

select lives_ok(
  $$insert into public.agent_tasks (
      id, workspace_id, idempotency_key, objective, source_urls, constraints,
      deadline_at, created_by
    ) values (
      '10000000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000001',
      'fixture-own-workspace',
      'Tarea canónica del espacio autenticado para probar acceso.',
      '["https://supabase.com/docs/guides/queues"]'::jsonb,
      '[]'::jsonb,
      now() + interval '1 hour',
      '30000000-0000-4000-8000-000000000001'
    )$$,
  'authenticated can insert a bounded task in its workspace'
);

select is(
  (select count(*)::integer from public.agent_tasks),
  1,
  'authenticated reads only its workspace'
);

select throws_ok(
  $$insert into public.agent_tasks (
      id, workspace_id, idempotency_key, objective, source_urls, constraints,
      deadline_at, created_by
    ) values (
      '10000000-0000-4000-8000-000000000003',
      '20000000-0000-4000-8000-000000000002',
      'fixture-forbidden-workspace',
      'Intento de crear una tarea fuera del espacio autorizado.',
      '["https://supabase.com/docs/guides/queues"]'::jsonb,
      '[]'::jsonb,
      now() + interval '1 hour',
      '30000000-0000-4000-8000-000000000001'
    )$$,
  '42501',
  null,
  'authenticated cannot insert into another workspace'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"30000000-0000-4000-8000-000000000001","role":"authenticated","app_metadata":{"workspace_id":"20000000-0000-4000-8000-000000000002"},"user_metadata":{"workspace_id":"20000000-0000-4000-8000-000000000001"}}',
  true
);
select is(
  (select count(*)::integer from public.agent_tasks),
  1,
  'app_metadata controls workspace access and user_metadata is ignored'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"30000000-0000-4000-8000-000000000001","role":"authenticated","app_metadata":{"workspace_id":"20000000-0000-4000-8000-000000000001"}}',
  true
);
select lives_ok(
  $$insert into public.agent_approvals (
      id, workspace_id, task_id, scope, approved_by, payload_sha256, valid_until
    ) values (
      '40000000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000001',
      '10000000-0000-4000-8000-000000000001',
      'EXECUTE_ONCE',
      '30000000-0000-4000-8000-000000000001',
      repeat('a', 64),
      now() + interval '1 hour'
    )$$,
  'authenticated can approve an exact payload for its own task'
);

select throws_ok(
  $$insert into public.agent_approvals (
      id, workspace_id, task_id, scope, approved_by, payload_sha256, valid_until
    ) values (
      '40000000-0000-4000-8000-000000000002',
      '20000000-0000-4000-8000-000000000001',
      '10000000-0000-4000-8000-000000000002',
      'EXECUTE_ONCE',
      '30000000-0000-4000-8000-000000000001',
      repeat('b', 64),
      now() + interval '1 hour'
    )$$,
  '23503',
  null,
  'database rejects an approval whose task belongs to another workspace'
);

reset role;

select isnt(has_table_privilege('authenticated', 'public.agent_tasks', 'update'), true, 'authenticated cannot update task state');
select isnt(has_table_privilege('authenticated', 'public.agent_tasks', 'delete'), true, 'authenticated cannot delete tasks');
select isnt(has_table_privilege('authenticated', 'public.agent_runs', 'insert'), true, 'authenticated cannot create runs');
select isnt(has_table_privilege('authenticated', 'public.agent_artifacts', 'insert'), true, 'authenticated cannot create artifacts');
select is((select count(*)::integer from pgmq.list_queues() where queue_name = 'agent_jobs'), 1, 'durable queue exists once');
select is((select relpersistence from pg_class where oid = 'pgmq.q_agent_jobs'::regclass), 'p', 'agent_jobs uses a logged table');
select isnt(has_table_privilege('authenticated', 'pgmq.q_agent_jobs', 'select'), true, 'queue is not exposed directly to authenticated');
select isnt(has_table_privilege('anon', 'pgmq.q_agent_jobs', 'select'), true, 'queue is not exposed directly to anon');

select * from finish();
rollback;
