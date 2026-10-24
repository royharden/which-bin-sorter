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
