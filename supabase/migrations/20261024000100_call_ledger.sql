-- call_ledger: one row per paid identify dispatch attempt, keyed by the client's request_id (PLAN.md 4.8).
-- Written only through the security-definer RPCs in 20261024000400_rpcs.sql. RLS is enabled with NO policies and
-- anon/authenticated hold no table privileges, so the public API cannot read or write it.
-- `result` holds only normalized ids / confidences / attributes / item_count / image_quality: never free_label,
-- image bytes, raw provider bodies or user text. Retention: 30 days (public.purge_expired_call_ledger()).

create table if not exists public.call_ledger (
  request_id        uuid primary key,
  request_digest    text not null check (request_digest ~ '^[0-9a-f]{64}$'),
  created_at        timestamptz not null default now(),
  settled_at        timestamptz,
  client_hash       text check (client_hash is null or client_hash ~ '^[0-9a-f]{64}$'),
  op                text not null check (op in ('identify')),
  provider          text check (provider is null or length(provider) <= 32),
  model             text check (model is null or length(model) <= 128),
  prompt_version    text check (prompt_version is null or length(prompt_version) <= 64),
  closed_list_hash  text check (closed_list_hash is null or closed_list_hash ~ '^[0-9a-f]{64}$'),
  upload_sha256     text check (upload_sha256 is null or upload_sha256 ~ '^[0-9a-f]{64}$'),
  reserved_usd      numeric not null check (reserved_usd > 0),
  input_tokens      int check (input_tokens is null or input_tokens >= 0),
  output_tokens     int check (output_tokens is null or output_tokens >= 0),
  cost_usd          numeric check (cost_usd is null or cost_usd >= 0),
  price_table_as_of date,
  status            text not null default 'reserved'
                      check (status in ('reserved', 'settled', 'uncertain', 'error')),
  replay_count      int not null default 0 check (replay_count >= 0),
  latency_ms        int check (latency_ms is null or latency_ms >= 0),
  error_code        text check (error_code is null or error_code ~ '^[a-z_]{1,64}$'),
  result            jsonb check (
                      result is null
                      or (
                        jsonb_typeof(result) = 'object'
                        and not (result ? 'free_label')
                        and pg_column_size(result) <= 4096
                      )
                    )
);

comment on table public.call_ledger is
  'Paid identify calls: reservation, settlement, idempotent replay. No free_label, image bytes or raw bodies.';

-- Retention purge and day-based reconciliation scan by creation time.
create index if not exists call_ledger_created_at_idx on public.call_ledger (created_at);

alter table public.call_ledger enable row level security;
-- No policies on purpose: with RLS on and no policy, every non-bypass role sees and changes nothing.

revoke all on table public.call_ledger from public;
revoke all on table public.call_ledger from anon;
revoke all on table public.call_ledger from authenticated;
