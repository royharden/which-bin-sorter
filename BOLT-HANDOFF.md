# Bolt infrastructure handoff — Which Bin?

## Target and readiness

- App root: this inner product repository, branch main. Outer planning/agent records are not part of an import.
- Database: **Bolt Database**, proposed fresh empty target. No connection exists; applied baseline is unknown/unverified.
- Status: **implementation complete, unverified** for source construction. Infrastructure, dependency setup and every
  runtime check are pending. There is no package lockfile, successful build, provisioned table or deployed function.
- Hosting/publication: prepare only. Current run authorizes no push, remote creation, import, provision, deploy or publish.
- Future Bolt action: **inspect and prepare only**. Owner prerequisites: later repository/import authorization,
  intended database connection, council choice, provider model/prices/secrets, disclosure and spend authorization.

## Commands and frontend

Node >=20, npm; package versions are pinned but compatibility unverified. Later run `npm install`, review/commit
package-lock.json, then use `npm ci`. Commands: `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` (dist).
None has run. Check edge separately with `deno check supabase/functions/identify/index.ts`.
Public config in src/lib/config.ts and nullable client src/lib/supabase.ts: VITE_APP_MODE, VITE_SUPABASE_URL,
VITE_SUPABASE_ANON_KEY. Unset mode is explicit demo with no client/network; live missing config shows setup, no fallback.
Reserve a dev port before starting a local server. All exact later checks are in docs/DEFERRED-VALIDATION.md.

## Ordered database inventory — all unapplied

| Order | File in supabase/migrations | Resources |
|---|---|---|
| 1 | 20261024000100_call_ledger.sql | call_ledger with bounded normalized result and RLS/revokes |
| 2 | 20261024000200_feedback.sql | append-only feedback, triggers and RLS/revokes |
| 3 | 20261024000300_budget_and_rate.sql | daily_budget and rate_window, RLS/revokes |
| 4 | 20261024000400_rpcs.sql | reserve_model_call, settle_model_call, record_feedback, operator purge_expired_call_ledger |

All four tables have no browser grants/policies. RPCs are security definer with pinned search_path and execute
restricted to service_role; anon/authenticated/public access is revoked. The intentionally anonymous edge handler is
the only browser mutation path. There are no accounts, tenant memberships or user-owned records. Rate hashes derive
from trusted platform address + salt + UTC day, never arbitrary client identity. CORS is not authentication.

Reserve and feedback claim idempotency keys before rate mutation and roll back rejected new claims. Budget is durable
and atomic in source; concurrency/RLS are unproven until applied and exercised. Inspect migration tracking first;
apply only pending files, preserve existing data, and reconcile drift rather than replay or drop resources.
No database seeds, extensions, storage, Realtime, webhooks, cron, auth providers or long-running workers are required.

## Function and secrets

`identify`: supabase/functions/identify/index.ts, one Deno function. POST op identify accepts bounded re-encoded JPEG,
UUID/digest-bound identity and version metadata; returns normalized bin-free vision or a typed failure. POST op feedback
accepts bounded serialized result metadata and its own UUID, returns saved only after insert/replay. OPTIONS preflight
is allowed. Exact types/validation are in handler.ts. Pure function folder is self-contained; URL-imported supabase-js
is pinned at 2.45.4 in ledger.ts. No remote URL intake, photo persistence or storage bucket.

supabase/config.toml currently has verify_jwt=true. The endpoint is deliberately public, without user accounts; the
browser uses a public project key. Verify actual Bolt key/gateway compatibility before changing this setting. No
anon-key claim substitutes for user authentication. ALLOWED_ORIGINS pins exact origins; server applies body/JPEG/
dimension/depth limits, per-client rate and global budget. Trusted address source is currently null, so paid calls fail closed.

| Setting | Consumer / source | Current readiness |
|---|---|---|
| ANTHROPIC_API_KEY | identify/provider, owner provider account | Missing; server secret only |
| CLIENT_HASH_SALT | identify/client hash, owner-generated | Missing; server secret only |
| LIVE_MODEL_ENABLED | identify gate | Default false; true only with authorization |
| DAILY_BUDGET_USD | reserve RPC cap | Owner limit required, no spend granted |
| ALLOWED_ORIGINS | CORS allowlist | Owner final origin required |
| FUNCTION_MOCK_MODE | identify smoke test | Default false; bypasses provider/ledger, tags mock; live browser rejects it |
| SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY | ledger adapter | Platform-injected, verify availability; never browser values |
| EVAL_BUDGET_USD | local eval only | Separate owner authorization; never function/frontend config |

Model id in config/model.json is null; config/prices.json unverified/empty. config/runtime.json trusted_address_source
is null. Pin supported model/prices and verified trusted-address behavior at activation; update serverConfig.ts mirrors
and parity tests. Missing DB yields ledger_unavailable; missing provider configuration refuses live; no silent mock.
No secret may use VITE_ or enter code/chat. Example names only are in .env.example.

## Retention and failure operations

No photos or raw labels/addresses/bodies are stored. Hashes and normalized identification metadata are retained.
The ledger purge helper is service-role-only and operator-run; there is no automatic 30-day scheduler. It protects
`reserved` rows only; expired rows in every other status, including `uncertain`, are purge-eligible. Purge deletes ledger
rows without adjusting daily-budget reservation/spend totals. Before invoking purge, reconcile every eligible uncertain
charge against provider usage/billing and daily-budget totals. Preserve an auditable receipt tied to the request/digest,
with charge evidence and any authorized correction, before purge; defer purge while any eligible charge remains unresolved.
Feedback is append-only with no automatic retention job.
Before clearing any reservation or abandoned eval lock: inspect pinned request/digest and provider usage, preserve a
receipt, establish charge and choose an authorized auditable correction. Never refund or redispatch an uncertain charge
merely to unblock a budget. A settlement failure can return a result plus settlement_pending; duplicate dispatch remains
forbidden. Write and dry-run an audited reconciliation procedure at activation (DEFERRED #8a and M2-6), including its
mandatory reconciliation-before-purge order; none ran here.

## Acceptance still pending

- Dependency/lockfile, strict tsc/lint/Vitest, Deno check, build/browser bundle and responsive journey.
- Fresh DB migration apply; anonymous table/RPC denial; concurrent reserve at cap; feedback identical/different-digest
  races at the last rate slot; append-only mutation denial and rollback.
- Trusted-address/spoof behavior, gateway key type, CORS, secrets, price/token bound and tiny separately authorized live call.
- Browser/device EXIF/GPS/orientation, caps, consent, provenance refusal and server-confirmed feedback receipts.
- Real council/source rights, licensed gold photos, audited MIT preprocessing adapter, dev tuning and once-only heldout
  evaluation. Offline fixture report first, always labelled unmeasured. CLIP not run; Jev not evaluated / not included.

## One future prompt after authorized import

> Read BOLT-HANDOFF.md and inspect this imported inner repository at the intended branch/revision. Target Bolt Database.
> Compare implemented resources with this inventory. Where authorized read-only access exists, inspect migration history
> and schema to resolve the unknown baseline. Preserve the app design, database and data. Prepare a reviewable setup plan
> listing actual pending migrations/functions/configuration, owner secrets and validation steps. Do not create or change
> cloud resources, apply migrations, deploy functions, enter secrets, enable schedules, publish, or replace live integrations
> with mocks. Report concrete gaps and owner decisions. Do not describe proposed resources or unexecuted checks as complete.
