-- daily_budget + rate_window: durable, atomic spend cap and rate limit (PLAN.md 2, 4.8). Server-side only.
-- daily_budget.day is the UTC calendar day. The cap is authoritative: reserve_model_call only reserves when
-- reserved_usd + spent_usd + worst_case <= cap_usd, in one guarded UPDATE.
-- rate_window keys: client_hash is the per-client hash or the literal '__global__' (feedback without a trusted
-- client identity); window_start is the bucket index floor(epoch_seconds / window_seconds).

create table if not exists public.daily_budget (
  day          date primary key,
  cap_usd      numeric not null check (cap_usd >= 0),
  reserved_usd numeric not null default 0 check (reserved_usd >= 0),
  spent_usd    numeric not null default 0 check (spent_usd >= 0)
);

comment on table public.daily_budget is 'Per-UTC-day model spend: reserved (in flight or uncertain) and spent.';

create table if not exists public.rate_window (
  client_hash  text not null check (client_hash = '__global__' or client_hash ~ '^[0-9a-f]{64}$'),
  op           text not null check (op in ('identify', 'feedback')),
  window_start bigint not null check (window_start >= 0),
  count        int not null default 0 check (count >= 0),
  primary key (client_hash, op, window_start)
);

comment on table public.rate_window is 'Fixed-window request counters per client hash (or __global__) and op.';

alter table public.daily_budget enable row level security;
alter table public.rate_window enable row level security;
-- No policies on purpose.

revoke all on table public.daily_budget from public;
revoke all on table public.daily_budget from anon;
revoke all on table public.daily_budget from authenticated;

revoke all on table public.rate_window from public;
revoke all on table public.rate_window from anon;
revoke all on table public.rate_window from authenticated;
