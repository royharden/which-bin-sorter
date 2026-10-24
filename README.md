# Which Bin?

One household item → a rule-backed answer, a clarifying question, or an abstention with a reason.

**Fixture City — not real disposal guidance. Implementation complete for source construction, runtime unverified.**
Coding agents wrote the code. Dependencies have never been installed; tests, type checks, lint, builds, generators,
browsers, databases and model calls have never run. Static syntax/data parsing and separate source reviews are the
only validation performed. There is no lockfile, deployment or measured accuracy result.

## What is built

React 18 + TypeScript + Vite with plain CSS. Photo intake checks JPEG/PNG/WebP signatures and a 5 MB original cap,
then redraws a JPEG at <=1024 px and <=1.5 MB. Typed search uses aliases/tokens without a model. Vision supplies
closed-list item ids and attributes; `src/core/resolve.ts` alone selects a recommendation bin from the rules.
The UI supports clarification, item correction, feedback, citations, rules version, disclaimer and council links.
The schema rejects a model's bin field, but model item/attribute errors can still affect an outcome.

The bundled table has 34 invented entries. Its URLs use `example.invalid`; its verified date means fixture creation,
not council verification. `rules_version` is the runtime SHA-256 of canonical rules JSON, not a hand-written version.
Thresholds (0.8 confidence, 0.1 margin) are placeholders, not tuned results. Real council rules and gold photos are absent.

## Later local activation

The following commands are instructions for a later authorized validation phase; none has been run:

```sh
npm install
npm run typecheck
npm run lint
npm test
npm run build
```

Review and commit the newly generated `package-lock.json`, then use `npm ci` for reproducible installs. Node >=20
is declared; dependency compatibility remains unverified. Reserve a local port through the agent-ports workflow before
starting `npm run dev -- --port <reserved-port>`. See [deferred validation](docs/DEFERRED-VALIDATION.md) for all pending checks.

No env defaults to **demo**: authored, not recorded mock responses execute locally with an in-memory feedback sink.
Sample images are canvas-drawn labels, not real item photos. They traverse normal intake and prove only intended pipeline
wiring. Try pizza box (greasy), answer Yes, report “This is wrong”, change item to cardboard box, type aerosol and
answer Not sure; two-item and injection samples exercise abstention/rejection. Unknown uploaded photos have no recognized
mock response. Demo feedback says `demo, not saved` and disappears on reload.

Explicit `VITE_APP_MODE=live` requires public database config or shows setup. It never silently falls back to demo;
mock-provenance responses are rejected. Live uploads require a consent tap. The app stores no photos; it retains resized
image hashes and normalized identification metadata for idempotency. Provider policy applies to transmitted photos.
The 30-day ledger purge is operator-run, not a scheduled guarantee. It protects `reserved` rows only; expired
`uncertain` rows are purge-eligible. Before invoking purge, reconcile eligible uncertain charges against provider
usage/billing and daily-budget totals and preserve an auditable receipt; defer purge while any remain unresolved.
Purge does not adjust budget totals. Feedback retention is not automatically purged. Do not upload sensitive material
before reviewing the disclosure.

## Backend and configuration

Target is **Bolt Database**, one `identify` Deno edge function with identify and feedback operations, four ordered SQL
migrations, server-only ledger/feedback/budget/rate tables and restricted RPCs. Nothing is provisioned or applied.
See [BOLT-HANDOFF.md](BOLT-HANDOFF.md), the single infrastructure inventory and inspection-only prompt.

Public names: `VITE_APP_MODE`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`. Server names and defaults are documented
in [.env.example](.env.example). Never put provider/service-role secrets in a `VITE_` variable.
Model id is null, prices unverified, trusted address source null, live gate off and no spend authorized. Live activation
requires a verified model/price pin, matching function config mirrors, trusted platform address configuration, database,
secrets, CORS and explicit budget authorization. DB failure prevents dispatch. Timeouts/unknown charges retain reservations;
settlement failure never automatically retries a paid call.

## Evaluation, never run

There are 60 synthetic text queries (36 dev/24 heldout, disjoint item groups), eight authored photo-fixture rows and
32 authored cache records. These are not the proposed 200-query/120-photo real evaluation. Fixture metrics do not measure vision.

```sh
npm run eval -- --offline --fixture --split dev --out results/fixture-dev --limitations results/fixture-dev/LIMITATIONS.md
```

This later command writes fresh results.md/results.jsonl plus optional limitations; existing outputs are not overwritten.
`--offline` alone requires complete real cache and configured identity, never silent fixture substitution. Methods cover
System, reused no-abstain identification, frozen generic mapping, rules-in-prompt, an unsure variant, typed oracle and T1
alias search. T2 is live-only; CLIP is a typed **not run** stub. Jev: **not evaluated / not included**.

Reports include explicit denominators/N/A, Wilson intervals, attribute recall/null rate including missing predictions,
contamination cost (weight 3), risk/coverage, named failures and same-System-subset/unsure-intersection comparisons.
Tied scores that prevent equal attained coverage are labelled unavailable. No lower-error claim has been measured.
Live evaluation is explicitly gated and budget-reserved; budget stop writes an incomplete report. A heldout run requires
`--confirm-heldout-once` and an atomic `results/heldout.lock`. Tune dev first; never clear locks or rerun heldout casually.
Photo preprocessing requires an audited pure-JS MIT codec adapter, not yet selected or installed.

See [architecture](docs/ARCHITECTURE.md), [acceptance map](docs/ACCEPTANCE.md), [limitations](docs/LIMITATIONS.md) and
[rules sources](rules/SOURCES.md). Exports are internal candidate-reuse modules (`rulestable`, `cited`, `providers`,
`callledger`, `evalkit`), not published packages. MIT covers original code; no third-party datasets or unlicensed code are shipped.
