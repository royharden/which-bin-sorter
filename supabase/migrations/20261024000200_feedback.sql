-- feedback: append-only "This is wrong" reports (PLAN.md 4.7, 4.8). An untrusted user report, never a rules edit.
-- feedback_id is the idempotency key, bound to feedback_digest. No free text, no free_label: `outcome` is the
-- validated serializer output {type, item_id?, bin?, reason_code?, rule_id?}, size-bounded.
-- Written only through public.record_feedback(). RLS on, no policies, no anon/authenticated privileges.

create table if not exists public.feedback (
  feedback_id         uuid primary key,
  feedback_digest     text not null check (feedback_digest ~ '^[0-9a-f]{64}$'),
  created_at          timestamptz not null default now(),
  identify_request_id uuid,
  kind                text not null check (kind in ('wrong_bin', 'wrong_item', 'other')),
  upload_sha256       text check (upload_sha256 is null or upload_sha256 ~ '^[0-9a-f]{64}$'),
  outcome             jsonb not null check (
                        jsonb_typeof(outcome) = 'object'
                        and outcome ? 'type'
                        and pg_column_size(outcome) <= 1024
                      ),
  rules_version       text not null check (length(rules_version) between 1 and 128),
  client_hash         text check (client_hash is null or client_hash ~ '^[0-9a-f]{64}$')
);

comment on table public.feedback is 'Append-only user feedback reports. Untrusted; never edits the rules table.';

-- Append-only: any UPDATE, DELETE or TRUNCATE raises, whoever runs it (including the table owner and service_role).
create or replace function public.feedback_append_only()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception 'feedback is append-only (% rejected)', tg_op using errcode = '42501';
end;
$$;

revoke all on function public.feedback_append_only() from public;
revoke all on function public.feedback_append_only() from anon;
revoke all on function public.feedback_append_only() from authenticated;

drop trigger if exists feedback_no_update_delete on public.feedback;
create trigger feedback_no_update_delete
  before update or delete on public.feedback
  for each row execute function public.feedback_append_only();

drop trigger if exists feedback_no_truncate on public.feedback;
create trigger feedback_no_truncate
  before truncate on public.feedback
  for each statement execute function public.feedback_append_only();

alter table public.feedback enable row level security;
-- No policies on purpose.

revoke all on table public.feedback from public;
revoke all on table public.feedback from anon;
revoke all on table public.feedback from authenticated;
