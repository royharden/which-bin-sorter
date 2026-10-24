# Deferred validation

This project was constructed under **Dirty Mode**: source, tests and docs were written and only static checks ran
(syntax-only parse of every `.ts`/`.js`/`.mjs` file, `JSON.parse` of every JSON file, source inspection). Nothing
below has been executed. Each row says what is still unverified, why, and the exact command that verifies it at
activation. Run from the repo root unless stated otherwise.

Status of every row: **pending**.

## From the build plan (PLAN.md section 8)

| # | What | Why deferred | Exact command |
|---|---|---|---|
| 1 | Install dependencies, generate and commit `package-lock.json`; then clean install, type check, lint, tests | No installs in Dirty Mode, so no lockfile can exist | `npm install && git add package-lock.json && npm ci && npx tsc --noEmit -p tsconfig.json && npx tsc --noEmit -p tsconfig.node.json && npx eslint . && npx vitest run` |
| 2 | Deno type check of the edge function (incl. `index.ts`, `ledger.ts`, excluded from tsconfig/eslint/coverage) and Bolt deploy | No Deno, no deploy in Dirty Mode | `deno check supabase/functions/identify/index.ts` then deploy through Bolt |
| 3 | Production build; bundle contains no Deno-only code | No builds in Dirty Mode | `npm run build && grep -r "Deno\." dist/ ; test $? -eq 1` |
| 4 | Migrations apply on a fresh Bolt Database | No database in Dirty Mode | Apply `supabase/migrations/*.sql` in order on a fresh Bolt Database (or `supabase db reset` locally) |
| 5 | Anon key cannot select / insert / call RPCs on any table | Needs a live database | With the anon key: `select` on each table, `insert` into each table, `rpc('reserve_model_call', ...)` - all must be denied |
| 6 | `reserve_model_call` atomicity and idempotency under concurrency | Stubs cannot prove SQL concurrency | Concurrent-call script against the deployed RPC at the cap (two calls cannot both pass; same id + digest replays) |
| 7 | Gateway `verify_jwt` setting vs key type | Needs the platform | Deploy, then call `identify` with and without the anon key and confirm the documented behaviour |
| 8 | Trusted client address source + spoof test | Platform-specific; `trusted_address_source` is null until activation | Set `config/runtime.json` `trusted_address_source`, then send a spoofed `X-Forwarded-For` and confirm the hash ignores it |
| 8a | Uncertain-reservation reconcile runbook | Needs real ledger rows | Write and dry-run the runbook against a ledger row in status `uncertain` |
| 9 | Real-browser canvas re-encode strips EXIF/GPS and caps at 1024 px | No browsers in Dirty Mode | Upload a GPS-tagged JPEG in Chrome/Safari; inspect the re-encoded bytes for an APP1 segment and dimensions |
| 10 | HEIC on iPhone is rejected with the "use JPEG/PNG" copy | Needs a device | Upload a HEIC photo from an iPhone in demo mode |
| 11 | Anthropic request shape and token usage | No network or paid calls in Dirty Mode | One budgeted live call with `LIVE_MODEL_ENABLED=true`; compare the ledger row to provider usage |
| 12 | Verified price table and worst-case cost math | Prices unverified (`config/prices.json` status `unverified`) | Fill `config/prices.json` from the provider's published prices; compare worst-case vs a real ledger row |
| 13 | Threshold tuning on the dev split | No photo set yet; `config/thresholds.json` is a placeholder | `npx tsx scripts/tune-thresholds.ts --split dev` |
| 14 | Replace authored mock responses with recorded ones | Authored, not recorded | Record live responses for each fixture photo and update `mockResponses.ts` (provenance stays "mock") |
| 15 | Real locality table | Fixture City is synthetic | `npx tsx scripts/validate-rules.ts rules/<locality>.json --mode release --stale fail --today <date>` |
| 16 | Photo gold set + `prep-photos` decoder package licence check | Photos not taken; package not chosen | Licence-check the chosen MIT decoder, then `npx tsx scripts/prep-photos.ts` |
| 17 | Held-out run, once | Needs gold set + live model | `npx tsx scripts/eval.ts --split heldout --confirm-heldout-once` |
| 18 | Injection photo live outcome recorded | Needs live model | Live eval row for the injection photo; record outcome in `docs/LIMITATIONS.md` |
| 19 | CLIP baseline licence + run | Weights fetch = network | Licence-check `@huggingface/transformers`; run method 4 in `scripts/eval.ts` |
| 20 | Jev | Only if Roy wants it | n/a until requested (README verdict "not evaluated / not included") |
| 21 | Disclosure / live-consent copy review | Wording for Roy to review | Roy reviews the consent text in `src/ui/LiveConsent.tsx` |
| 22 | Run the generators and commit their outputs; fill `source_sha256` aliases in mocks | Generators cannot run in Dirty Mode | `npx tsx scripts/gen-item-ids.ts && npx tsx scripts/make-fixture-images.ts` then commit and update `mockResponses.ts` |
| 23 | TSX files were never syntax-checked by a tool (the syntax checker skips `.tsx`) | Node type stripping does not handle JSX | `npx tsc --noEmit -p tsconfig.json` (covers `src/main.tsx`, `src/ui/*.tsx`, `tests/**/*.tsx`) |

## Added in M1 (scaffold + rules core)

| # | What | Why deferred | Exact command |
|---|---|---|---|
| M1-1 | Every M1 test runs and passes (fixture coverage, validator classes, search, resolver tables and flows, attributes, thresholds, hash / rules version, feedback serializer + citations, static invariant) | Tests are written, not run | `npx vitest run tests/fixtureCity.test.ts tests/validateRules.test.ts tests/search.test.ts tests/resolve.test.ts tests/attributes.test.ts tests/thresholds.test.ts tests/hash.test.ts tests/feedbackOutcome.test.ts tests/static/only-resolver-selects-bins.test.ts` |
| M1-2 | Strict type check of the M1 sources under `strict`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`, `erasableSyntaxOnly`, `allowImportingTsExtensions` | No `tsc` available in Dirty Mode | `npx tsc --noEmit -p tsconfig.json && npx tsc --noEmit -p tsconfig.node.json` |
| M1-3 | The exact dependency versions in `package.json` exist on the registry and work together (React 18.3.1, Vite 6.2.6, Vitest 3.1.1, TypeScript 5.8.3, typescript-eslint 8.29.0, ESLint 9.24.0, ...) | Chosen from memory; no registry access | `npm install` (fails on a missing version); `npm ls` shows no peer-dependency errors |
| M1-4 | ESLint flat config loads; per-directory `no-restricted-imports` patterns (`../*`, `../../**`, `**/scripts/**`) block what they should and nothing else | ESLint never ran | `npx eslint .` (expect clean), then plant `import x from "../../scripts/eval.ts"` in a `src/core` file and confirm `npx eslint src/core` reports it |
| M1-5 | `scripts/validate-rules.ts` CLI behaviour and exit codes | tsx scripts are not run in Dirty Mode | `npx tsx scripts/validate-rules.ts rules/fixture-city.json --today 2026-10-24 --mode fixture --stale fail` (exit 0, prints rules_version); `... --mode release` (exit 1, release_* errors); `... --today 2027-04-23 --stale fail` (exit 1, stale_source); `... --today 2027-04-23 --stale warn` (exit 0 with warnings) |
| M1-6 | `rules/rules.schema.json` agrees with `rules/fixture-city.json` under a real JSON Schema engine | No schema engine installed | `npx --yes ajv-cli@5 validate --spec=draft2020 -s rules/rules.schema.json -d rules/fixture-city.json` |
| M1-7 | JSON module imports (`rules/fixture-city.json`, `config/thresholds.json`) resolve under Vite, Vitest and tsx | No bundler / runner executed | Covered by M1-1 (`vitest`) and #3 (`npm run build`); for tsx: `npx tsx -e "import('./src/core/loadRules.ts').then(m => m.loadFixtureCity('2026-10-24')).then(r => console.log(r.version))"` |
| M1-8 | WebCrypto `crypto.subtle` is available in the Vitest `node` environment (sha256, rules_version) | Not run | Covered by M1-1 (`tests/hash.test.ts`) on Node >= 20 |
| M1-9 | Placeholder `src/ui/App.tsx` + `src/main.tsx` render | No dev server / browser in Dirty Mode | `npm run dev` and open the page (shows the "Fixture: not real disposal guidance" note) |

## Added in M2 (vision contract, function and database)

M2 was completed from inherited, uncommitted source. Static inspection and the outer syntax-only parser do not
establish that these contracts, type checks or migrations pass. All test sources below are written, never run.

| # | What | Why deferred | Exact command / activation procedure |
|---|---|---|---|
| M2-1 | Vision schema, mock traps, browser normalization, closed-list parity, config/rule mirrors, image bounds and handler contracts | Test execution forbidden in Dirty Mode | `npx vitest run tests/visionSchema.test.ts tests/itemIds.test.ts tests/serverConfig.test.ts tests/ruleCatalog.test.ts tests/imageHeader.test.ts tests/handler.test.ts` |
| M2-2 | AST dependency graph and bin-construction invariants over the completed M2 tree | The static tests themselves have not executed; parsing a test does not prove its assertions | `npx vitest run tests/static/import-boundaries.test.ts tests/static/only-resolver-selects-bins.test.ts` |
| M2-3 | Strict TypeScript, ESLint directory restrictions and dependency API compatibility | Only erasable-TS syntax was parsed; no resolver/type checker/linter ran | `npx tsc --noEmit -p tsconfig.json && npx tsc --noEmit -p tsconfig.node.json && npx eslint .` |
| M2-4 | Deno entrypoint, pinned esm.sh supabase-js import and RPC argument serialization | No Deno or network in Dirty Mode | `deno check supabase/functions/identify/index.ts`; after provisioning, exercise identify/feedback through Bolt with placeholder-priced smoke configuration before any authorized paid call |
| M2-5 | RPC privileges, rollback of ledger/rate/budget guards, concurrent idempotency and append-only feedback | FakeLedger tests only the handler seam; SQL was inspected, never applied | After #4-#6, attempt every RPC as anon/authenticated, submit same/different digests concurrently at the budget cap, compare all four tables, and confirm feedback UPDATE/DELETE/TRUNCATE are rejected |
| M2-6 | Settlement failure / uncertain-row reconciliation, 30-day retention and operator purge | No real ledger; retained reservations must never be automatically refunded | After #8a, call `select public.purge_expired_call_ledger(30);` as the operator; confirm old finalized rows expire and reserved rows remain. Reconcile uncertain rows against provider billing and daily-budget totals before altering them |
| M2-7 | Full browser graph, no server config in bundle, preprocessing-version parity | M3 has not wired the normalizer into the UI or authored the re-encoder yet | At M3 add the re-encoder parity assertion to `tests/serverConfig.test.ts`; then run `npx vitest run tests/serverConfig.test.ts tests/static/import-boundaries.test.ts` and the build/bundle check in #3 |
| M2-8 | Item-id generator reproducibility and M1 carry-forward fixes (null CLI input, independent reason-code coverage, combining-mark escape) | No generators, CLI scripts or tests may run now | `npx tsx scripts/gen-item-ids.ts --check`; run M1-1 and M1-5, including a temporary JSON file containing only `null` passed to `scripts/validate-rules.ts` (must report invalid rules rather than throw) |
| M2-9 | Feedback idempotency wins over a concurrent final rate slot, and a full-window rejection rolls back a new feedback id | SQL concurrency and database execution forbidden in Dirty Mode | Run both two-session cases and the guard rollback check in "Feedback concurrency activation regression" below against an isolated database with the migrations applied |

Settlement caveat: the handler attempts one settlement per dispatch. If the database cannot accept settlement,
the row remains reserved and requires operator reconciliation; successful provider output is returned with
`settlement_pending:true`. Error-path settlement failures also return `settlement_pending:true` alongside the
original error code. Final ledger status cannot be guaranteed during a DB outage; reserved rows need operator
reconciliation. No request is redispatched automatically.

## Feedback concurrency activation regression (M2-9)

**Pending; written after M2 review round 1, never executed.** This catches a duplicate request receiving
`rate_limited` after another transaction saved the same feedback id. FakeLedger and sequential handler tests
cannot reproduce the database lock interleaving. Use a fresh isolated database with all four migrations applied,
two independent operator connections, and no other writers. These are synthetic RPC-level digests and reports;
no model, real user data or paid call is needed. Do not disable append-only triggers or delete feedback to reset
a case. Use different ids/rate keys for the two cases as specified below.

Open terminal A and terminal B with `psql '<isolated-db-connection>' -X -v ON_ERROR_STOP=1`. This is a future
activation command, not a command run during construction. In **both** terminals select the same case settings:

```psql
-- Case 1: identical digest; terminal B must return replay, never rate_limited.
\set feedback_id 31000000-0000-4000-8000-000000000001
\set rate_char c
\set second_digest_char a
```

For case 2 repeat the entire procedure with these settings in both terminals instead:

```psql
-- Case 2: different digest; terminal B must return conflict, never rate_limited.
\set feedback_id 31000000-0000-4000-8000-000000000002
\set rate_char d
\set second_digest_char b
```

The test limit is **2**. The intentionally long test window (`2147483647` seconds) prevents a window boundary
from changing the interleaving. In terminal A, seed the committed rate counter to **limit - 1 = 1**, then claim
the new feedback id and consume the final slot inside a transaction that stays open:

```sql
insert into public.rate_window (client_hash, op, window_start, count)
values (repeat(:'rate_char', 64), 'feedback',
        floor(extract(epoch from now()) / 2147483647)::bigint, 1);

begin isolation level read committed;
select public.record_feedback(
  :'feedback_id'::uuid, repeat('a', 64), null, 'other', null,
  '{"type":"abstain"}'::jsonb, 'm2-concurrency-fixture',
  repeat(:'rate_char', 64), repeat(:'rate_char', 64), 2, 2147483647
);
-- Expected: {"status":"saved"}. Leave this transaction open; do not commit yet.
```

In terminal B submit the same id, using the selected case's second digest:

```sql
begin isolation level read committed;
select public.record_feedback(
  :'feedback_id'::uuid, repeat(:'second_digest_char', 64), null, 'other', null,
  '{"type":"abstain"}'::jsonb, 'm2-concurrency-fixture',
  repeat(:'rate_char', 64), repeat(:'rate_char', 64), 2, 2147483647
);
-- This statement must wait while terminal A's transaction remains open.
```

Only after B is waiting, issue `commit;` in A. B must then return `{"status":"replay"}` in case 1 or
`{"status":"conflict"}` in case 2. Issue `commit;` in B. In B, verify both expressions return `true`:

```sql
select count(*) = 1 and min(feedback_digest) = repeat('a', 64) as one_original_report
from public.feedback where feedback_id = :'feedback_id'::uuid;
select count = 2 as exactly_one_allowance_consumed
from public.rate_window
where client_hash = repeat(:'rate_char', 64) and op = 'feedback'
  and window_start = floor(extract(epoch from now()) / 2147483647)::bigint;
```

Finally, with that rate window still full, submit a **new** id to exercise the guard rollback. Run in B:

```sql
select public.record_feedback(
  '31000000-0000-4000-8000-000000000099'::uuid, repeat('e', 64), null, 'other', null,
  '{"type":"abstain"}'::jsonb, 'm2-concurrency-fixture',
  repeat(:'rate_char', 64), repeat(:'rate_char', 64), 2, 2147483647
);
-- Expected: {"status":"rate_limited"}.
select count(*) = 0 as rejected_claim_rolled_back
from public.feedback where feedback_id = '31000000-0000-4000-8000-000000000099'::uuid;
select count = 2 as rejected_claim_did_not_consume_allowance
from public.rate_window
where client_hash = repeat(:'rate_char', 64) and op = 'feedback'
  and window_start = floor(extract(epoch from now()) / 2147483647)::bigint;
-- Both expressions must be true. The rollback must succeed with append-only triggers enabled.
```

Record A/B responses, both durable-state checks and the rollback checks separately for each case. A premature B
response, `rate_limited` on the duplicate, an extra row/increment, an overwritten digest or a retained rejected
id fails this regression. Database privileges and direct UPDATE/DELETE/TRUNCATE rejection remain M2-5 checks.

## Added in M3 (intake, UI and demo journey)

All M3 source and test files are **written, never executed**. The approved outer-shell parser only stripped and
parsed `.ts` files without linking or evaluating them. It explicitly skipped TSX; those files received manual
source inspection only. CSS, canvas output, responsive appearance and assistive-technology behavior have not
been rendered or checked in a browser. M1-9's placeholder is superseded by the M3 app, still unrendered.

| # | What | Why deferred | Exact command / activation procedure |
|---|---|---|---|
| M3-1 | Intake signature/MIME/cap, injected encoder resize/retry/APP1 contract, SHA-256/base64, demo/live client boundaries and feedback receipts | Test execution forbidden in construction | `npx vitest run tests/sniff.test.ts tests/reencode.test.ts tests/hashes.test.ts tests/visionClient.test.ts tests/feedbackSink.test.ts tests/config.test.ts` |
| M3-2 | Full eight-step demo journey, all three result cards, disclaimers/council links, typed path with zero vision calls, reset, consent, retry identity, exactly-one feedback and object URL cleanup | Component tests are source only; canvas/encoder seams are injected, not browser evidence | `npx vitest run tests/App.journey.test.tsx tests/ResultCard.test.tsx tests/TypedSearch.test.tsx` |
| M3-3 | Completed browser dependency graph and re-encoder parity (M2-7 assertion is now written) | AST tests and bundle inspection still unexecuted | `npx vitest run tests/serverConfig.test.ts tests/static/import-boundaries.test.ts tests/static/only-resolver-selects-bins.test.ts`; then #3's build/bundle check |
| M3-4 | TSX, ambient import.meta.env declarations, strict types, Supabase invocation/error APIs, JSX and CSS build | Node's approved parser does not typecheck, resolve modules, parse TSX or render CSS | `npm run typecheck && npm run lint && npm run build` |
| M3-5 | Real-browser default createImageBitmap/OffscreenCanvas/HTML canvas and Image fallback, EXIF/GPS/orientation, JPEG output cap, URL cleanup, file chooser and iPhone HEIC | No browser, device, decoding, canvas or runtime execution allowed | After #1/#3, reserve a dev port through agent-ports, run `npm run dev -- --port <reserved-port>`, and perform #9/#10; inspect APP1 and dimensions for portrait/transparent/oversize files in Chrome and Safari, including the Image fallback; inspect URL revocations on replacement/unmount |
| M3-6 | Responsive layout, keyboard focus, screen reader announcements, reduced-motion and real eight-step tile journey | UI has only been inspected as source | Use the same reserved-port dev server at 375/768/1280 px; complete PLAN section 1 with keyboard and pointer, test all sample tiles, check focus/announcements, and confirm demo has no network requests |
| M3-7 | Fixture PNG generator writes usable synthetic images and hash manifest, with no overwritten files | Generator source parsed only; not executed | `npx tsx scripts/make-fixture-images.ts` in a fresh output set; inspect `eval/fixtures/images/*.png` and `source-hashes.json`, review generated aliases, then commit approved outputs as in #22 |
| M3-8 | Real live consent gate, edge error-body extraction, provenance/version/photo checks, replay and confirmed feedback saved receipts | No network, configured backend, provider dispatch or paid calls allowed | After #2/#4-#12 and explicit activation authorization, test consent cancel/accept, mock provenance refusal, same-request retry and confirmed/idempotent feedback through the actual deployed function; never treat fixture responses as live evidence |

M3 preserves accepted M1 rule text and source anchors: the aerosol question asks whether product/liquid remains,
and the pizza-box source anchor is `#pizza_box`. The plan's narrative paraphrases differ. A live
`invalid_vision_output` error does not contain a model id; its UI provenance is honestly labelled
`live · response rejected`, while successful responses require `live:<confirmed model-id>`.
