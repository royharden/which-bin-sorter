-- RPCs (PLAN.md 4.8): the ONLY write path into call_ledger, feedback, daily_budget and rate_window.
-- All are SECURITY DEFINER with a pinned search_path (public, then pg_temp last so a temp object can never shadow a
-- table), every object is schema-qualified, EXECUTE is revoked from public/anon/authenticated and granted to
-- service_role only (the edge function's platform-injected key).
--
-- Guard failures use private SQLSTATEs raised inside a sub-block: plpgsql runs a block that has an EXCEPTION clause
-- inside a savepoint, so raising rolls back everything the block did (ledger/feedback insert, rate increment) and
-- the handler returns the guard's status. A failing guard leaves no new row and consumes no rate or budget.
--   WB429 = rate window full, WB402 = daily budget exhausted.
-- Concurrency: the rate upsert and the budget UPDATE each lock their row; a concurrent caller blocks, then
-- re-evaluates the guard against the committed row (READ COMMITTED re-check), so two calls at the cap cannot both
-- pass. Unproven here (DEFERRED-VALIDATION #6).

-- ---------------------------------------------------------------------------------------------------------------
-- reserve_model_call: idempotency check, rate window, daily budget, ledger row - one transaction.
-- Returns {status: reserved | replay (+result) | in_progress | conflict | rate_limited | budget_exhausted}.

create or replace function public.reserve_model_call(
  p_request_id       uuid,
  p_request_digest   text,
  p_client_hash      text,
  p_op               text,
  p_provider         text,
  p_model            text,
  p_prompt_version   text,
  p_closed_list_hash text,
  p_upload_sha256    text,
  p_worst_case_usd   numeric,
  p_cap_usd          numeric,
  p_rate_limit       int,
  p_window_seconds   int
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_day      date := (now() at time zone 'utc')::date;
  v_window   bigint;
  v_rows     int;
  v_existing public.call_ledger%rowtype;
begin
  if p_request_id is null
     or p_request_digest is null
     or p_client_hash is null
     or p_op is distinct from 'identify'
     or p_worst_case_usd is null or p_worst_case_usd <= 0
     or p_cap_usd is null or p_cap_usd < 0
     or p_rate_limit is null or p_rate_limit < 1
     or p_window_seconds is null or p_window_seconds < 1 then
    raise exception 'reserve_model_call: invalid arguments' using errcode = '22023';
  end if;

  begin
    -- 1. Idempotency. A new request_id inserts its reserved row; a known one is answered from that row and uses
    --    no rate or budget.
    insert into public.call_ledger (
      request_id, request_digest, client_hash, op, provider, model, prompt_version,
      closed_list_hash, upload_sha256, reserved_usd, status
    )
    values (
      p_request_id, p_request_digest, p_client_hash, p_op, p_provider, p_model, p_prompt_version,
      p_closed_list_hash, p_upload_sha256, p_worst_case_usd, 'reserved'
    )
    on conflict (request_id) do nothing;
    get diagnostics v_rows = row_count;

    if v_rows = 0 then
      select * into v_existing from public.call_ledger where request_id = p_request_id for update;
      if not found then
        raise exception 'reserve_model_call: ledger row disappeared' using errcode = '40001';
      end if;
      if v_existing.request_digest <> p_request_digest then
        return jsonb_build_object('status', 'conflict');
      end if;
      if v_existing.status = 'settled' and v_existing.result is not null then
        update public.call_ledger set replay_count = replay_count + 1 where request_id = p_request_id;
        return jsonb_build_object('status', 'replay', 'result', v_existing.result);
      end if;
      -- reserved (in flight), uncertain, error, or settled without a stored result: never a claimed success.
      return jsonb_build_object('status', 'in_progress');
    end if;

    -- 2. Rate window: upsert guarded by count < limit; zero rows touched = rate_limited.
    v_window := floor(extract(epoch from now()) / p_window_seconds)::bigint;
    insert into public.rate_window as rw (client_hash, op, window_start, count)
    values (p_client_hash, p_op, v_window, 1)
    on conflict (client_hash, op, window_start)
      do update set count = rw.count + 1
      where rw.count < p_rate_limit;
    get diagnostics v_rows = row_count;
    if v_rows = 0 then
      raise exception 'rate_limited' using errcode = 'WB429';
    end if;

    -- 3. Daily budget: ensure today's row (cap from DAILY_BUDGET_USD), then one guarded UPDATE; zero rows =
    --    budget_exhausted.
    insert into public.daily_budget (day, cap_usd)
    values (v_day, p_cap_usd)
    on conflict (day) do update set cap_usd = excluded.cap_usd;

    update public.daily_budget
       set reserved_usd = reserved_usd + p_worst_case_usd
     where day = v_day
       and reserved_usd + spent_usd + p_worst_case_usd <= cap_usd;
    get diagnostics v_rows = row_count;
    if v_rows = 0 then
      raise exception 'budget_exhausted' using errcode = 'WB402';
    end if;
  exception
    when sqlstate 'WB429' then
      return jsonb_build_object('status', 'rate_limited');
    when sqlstate 'WB402' then
      return jsonb_build_object('status', 'budget_exhausted');
  end;

  return jsonb_build_object('status', 'reserved');
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------
-- settle_model_call: reserved -> settled | error (reservation released, actual cost spent; unknown cost = the
-- worst-case reservation) or reserved -> uncertain (reservation KEPT in daily_budget.reserved_usd, never
-- auto-refunded; reconciled by runbook, DEFERRED-VALIDATION #8a). A row is settled at most once.

create or replace function public.settle_model_call(
  p_request_id    uuid,
  p_status        text,
  p_input_tokens  int,
  p_output_tokens int,
  p_cost_usd      numeric,
  p_price_as_of   date,
  p_latency_ms    int,
  p_error_code    text,
  p_result        jsonb
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row    public.call_ledger%rowtype;
  v_day    date;
  v_charge numeric;
  v_result jsonb := p_result;
begin
  if v_result is not null and jsonb_typeof(v_result) = 'null' then
    v_result := null;
  end if;
  if p_request_id is null or p_status is null or p_status not in ('settled', 'uncertain', 'error') then
    raise exception 'settle_model_call: invalid arguments' using errcode = '22023';
  end if;
  if p_cost_usd is not null and p_cost_usd < 0 then
    raise exception 'settle_model_call: negative cost' using errcode = '22023';
  end if;
  if p_status <> 'settled' and v_result is not null then
    raise exception 'settle_model_call: only a settled call stores a result' using errcode = '22023';
  end if;

  select * into v_row from public.call_ledger where request_id = p_request_id for update;
  if not found then
    raise exception 'settle_model_call: unknown request' using errcode = 'P0002';
  end if;
  if v_row.status <> 'reserved' then
    raise exception 'settle_model_call: already settled' using errcode = '55000';
  end if;

  -- The reservation was made on the UTC day of the row's creation (same transaction clock as reserve_model_call).
  v_day := (v_row.created_at at time zone 'utc')::date;

  if p_status = 'uncertain' then
    v_charge := null;
  else
    v_charge := coalesce(p_cost_usd, v_row.reserved_usd);
    update public.daily_budget
       set reserved_usd = greatest(reserved_usd - v_row.reserved_usd, 0),
           spent_usd    = spent_usd + v_charge
     where day = v_day;
  end if;

  update public.call_ledger
     set status            = p_status,
         settled_at        = now(),
         input_tokens      = p_input_tokens,
         output_tokens     = p_output_tokens,
         cost_usd          = v_charge,
         price_table_as_of = p_price_as_of,
         latency_ms        = p_latency_ms,
         error_code        = p_error_code,
         result            = v_result
   where request_id = p_request_id;
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------
-- record_feedback: claim feedback_id bound to feedback_digest, then take rate allowance in the same savepoint.
-- p_rate_key is the client hash, or '__global__' when there is no trusted per-client identity (client_hash null).
-- Returns {status: saved | replay | conflict | rate_limited}.

create or replace function public.record_feedback(
  p_feedback_id         uuid,
  p_feedback_digest     text,
  p_identify_request_id uuid,
  p_kind                text,
  p_upload_sha256       text,
  p_outcome             jsonb,
  p_rules_version       text,
  p_client_hash         text,
  p_rate_key            text,
  p_rate_limit          int,
  p_window_seconds      int
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_digest text;
  v_window bigint;
  v_rows   int;
begin
  if p_feedback_id is null
     or p_feedback_digest is null
     or p_rate_key is null
     or p_rate_limit is null or p_rate_limit < 1
     or p_window_seconds is null or p_window_seconds < 1
     or (p_client_hash is not null and p_client_hash <> p_rate_key)
     or (p_client_hash is null and p_rate_key <> '__global__') then
    raise exception 'record_feedback: invalid arguments' using errcode = '22023';
  end if;

  begin
    -- 1. Claim the id before touching the rate window. A competing insert waits for this transaction, then
    --    reads the committed digest without taking allowance, including when the first call fills the window.
    --    DO NOTHING preserves the append-only contract: replay/conflict never updates an existing report.
    insert into public.feedback (
      feedback_id, feedback_digest, identify_request_id, kind, upload_sha256, outcome, rules_version, client_hash
    )
    values (
      p_feedback_id, p_feedback_digest, p_identify_request_id, p_kind, p_upload_sha256, p_outcome, p_rules_version,
      p_client_hash
    )
    on conflict (feedback_id) do nothing;
    get diagnostics v_rows = row_count;

    if v_rows = 0 then
      select feedback_digest into v_digest from public.feedback where feedback_id = p_feedback_id;
      if not found then
        raise exception 'record_feedback: feedback row disappeared' using errcode = '40001';
      end if;
      return jsonb_build_object('status', case when v_digest = p_feedback_digest then 'replay' else 'conflict' end);
    end if;

    -- 2. Only a new id consumes allowance. Raising here rolls its insert back with this entire sub-block.
    v_window := floor(extract(epoch from now()) / p_window_seconds)::bigint;
    insert into public.rate_window as rw (client_hash, op, window_start, count)
    values (p_rate_key, 'feedback', v_window, 1)
    on conflict (client_hash, op, window_start)
      do update set count = rw.count + 1
      where rw.count < p_rate_limit;
    get diagnostics v_rows = row_count;
    if v_rows = 0 then
      raise exception 'rate_limited' using errcode = 'WB429';
    end if;
  exception
    when sqlstate 'WB429' then
      return jsonb_build_object('status', 'rate_limited');
  end;

  return jsonb_build_object('status', 'saved');
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------
-- purge_expired_call_ledger: 30-day retention (PLAN.md 4.7). Run manually / by the operator (no cron in scope).
-- Rows still `reserved` are kept for reconciliation (runbook, DEFERRED-VALIDATION #8a).

create or replace function public.purge_expired_call_ledger(p_retention_days int default 30)
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_rows int;
begin
  if p_retention_days is null or p_retention_days < 1 then
    raise exception 'purge_expired_call_ledger: invalid retention' using errcode = '22023';
  end if;
  delete from public.call_ledger
   where created_at < now() - make_interval(days => p_retention_days)
     and status <> 'reserved';
  get diagnostics v_rows = row_count;
  return v_rows;
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------
-- Privileges: service_role only.

revoke all on function public.reserve_model_call(uuid, text, text, text, text, text, text, text, text, numeric, numeric, int, int) from public;
revoke all on function public.reserve_model_call(uuid, text, text, text, text, text, text, text, text, numeric, numeric, int, int) from anon;
revoke all on function public.reserve_model_call(uuid, text, text, text, text, text, text, text, text, numeric, numeric, int, int) from authenticated;
grant execute on function public.reserve_model_call(uuid, text, text, text, text, text, text, text, text, numeric, numeric, int, int) to service_role;

revoke all on function public.settle_model_call(uuid, text, int, int, numeric, date, int, text, jsonb) from public;
revoke all on function public.settle_model_call(uuid, text, int, int, numeric, date, int, text, jsonb) from anon;
revoke all on function public.settle_model_call(uuid, text, int, int, numeric, date, int, text, jsonb) from authenticated;
grant execute on function public.settle_model_call(uuid, text, int, int, numeric, date, int, text, jsonb) to service_role;

revoke all on function public.record_feedback(uuid, text, uuid, text, text, jsonb, text, text, text, int, int) from public;
revoke all on function public.record_feedback(uuid, text, uuid, text, text, jsonb, text, text, text, int, int) from anon;
revoke all on function public.record_feedback(uuid, text, uuid, text, text, jsonb, text, text, text, int, int) from authenticated;
grant execute on function public.record_feedback(uuid, text, uuid, text, text, jsonb, text, text, text, int, int) to service_role;

revoke all on function public.purge_expired_call_ledger(int) from public;
revoke all on function public.purge_expired_call_ledger(int) from anon;
revoke all on function public.purge_expired_call_ledger(int) from authenticated;
grant execute on function public.purge_expired_call_ledger(int) to service_role;
