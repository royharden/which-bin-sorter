# Architecture

Status: source construction complete; runtime unverified. See DEFERRED-VALIDATION.md for every activation check.

## Data flow

Photo → signature/size intake → injected browser decoder/redraw → bounded JPEG and source/upload hashes → demo
provider or edge identify → shared strict bin-free validator → deterministic rules resolver → result card/citation.
Typed selection bypasses vision. Rule-authored clarification updates tri-state attribute provenance and re-resolves.
Changing item switches to selected mode and clears all old user/vision attributes and photo context. Feedback copies
an existing result through the single `serializeFeedbackOutcome` serializer; it never mutates the table.

`src/core` is the internal `rulestable` module; `cited.ts` emits source metadata. Only private `selectBin` inside
`resolve.ts` creates `ResolvedBin`. The module's only runtime resolver export is `resolve`. The `src/vision` client
revalidates outputs and strips free_label. Local mocks use the same validator. The browser can reach only allowlisted
pure function modules; live transport/handler/ledger/server config remain outside that graph. Direct-bin model
baselines exist only in `scripts/baselines`, never product imports.

## Rules and accepted resolver interpretations

Rules are committed JSON, not editable database content. Their canonical JSON SHA-256 is computed at runtime.
Closed item-list SHA-256 is a separate sorted-id identity; schema/preprocessing/prompt versions guard the transport.
Model ids/attributes are data, not disposal instructions. Rejected bin fields cannot supply a recommendation;
wrong item/attribute predictions can still select the wrong legitimate rule.

Vision gate order: multiple items, no candidate, poor image, low confidence, ambiguous bins; then ask-council,
unconditional answer, clarification, prioritized matching condition, instruction-only abstention or unknown condition.
Selected mode skips photo gates. No default bin is invented.

M1 review accepted two clarifications to plan prose. Clarify outcomes are distinguished by rule id (including prep
and citation), while candidate ambiguity compares reachable bins. Thus two rules sharing a bin can still require a
prep question. “Not sure” exhausts that attribute; other relevant attributes may still be asked before final
unknown_condition. The aerosol question asks whether product/liquid remains, so Yes means liquid_inside=true.
Source anchors come from rules data (`#pizza_box`), not the narrative shorthand `#pizza-box`.

Static compiler-API guards check syntax-level brand construction and imports; they are not security proofs. Indirect
brand fabrication through `any`, JSON.parse or functions without an explicit cast can escape syntactic detection.
Only source review has occurred; the guard tests have not run. Do not treat these tests as runtime authorization.

## Edge/database boundary

The Deno wrapper reads env, builds injected provider/ledger dependencies and calls pure `handler.ts`. Function
imports stay in its folder; root model/prices/runtime JSON and rule ids have const mirrors with parity-test source.
Activate changes in both root config and mirrors. Deno-only index/ledger are excluded from browser tsc/lint/coverage;
`deno check supabase/functions/identify/index.ts` remains pending.

The intentionally public endpoint has bounded bodies/images, strict operations, CORS, trusted-address-derived daily
client hashes, atomic rate/budget checks and capability-style UUID + matching-digest replay. Public project keys are
not user authentication and CORS is not authorization. Gateway JWT remains on until actual key/runtime compatibility
is verified. Live is refused without model, verified price, address source, salts/secrets and positive budget.

RPCs claim ids before rate mutation. Reserve rolls back rejected claims/rate/budget changes; feedback duplicates
return replay/conflict without consuming allowance. SQL locks, concurrency and RLS have only been inspected, not run.
Every paid attempt has a reservation before dispatch. Success settles sanitized output; errors/uncertain usage keep
conservative reservations. A failed settlement signals settlement_pending and never automatically redispatches.
Feedback is append-only and server-confirmed receipts follow insert/replay. Raw photos, addresses, bodies and labels
are not retained in the ledger. Purge is manual and protects `reserved` rows only; expired `uncertain` rows are eligible.
Before invoking purge, the operator must reconcile eligible uncertain charges against provider usage/billing and
daily-budget totals and preserve an auditable receipt; unresolved charges defer purge. Purge does not adjust budget
totals or automatically refund reservations.

## Evaluation boundaries

`src/evalkit` contains pure reusable metric/split helpers. `scripts/eval` owns filesystem/cache/ledger/locks/reporting;
`buildReport` and `buildLimitations` are pure. Fixture cache is authored method/fixture-id data, separate from real
nine-field-identity cache. Offline refuses misses; real reports refuse mock provenance. No-abstain reuses System
identification. Unsupported methods report not run, not zeros. Attribute-capable failures remain in recall/null
populations. Equal-coverage comparisons report actual coverages and unavailable if ties prevent a match.

Budget preflight and per-call durable reservations precede paid transport. Budget refusal writes incomplete reports;
invalid config/occupied locks remain setup errors. Heldout lock follows successful preflight and is once-only; tuning
is dev-only and refuses after heldout exposure. Text groups are frozen 36/24 and disjoint; photo prep uses seeded
item-group hashing and reports actual counts. PhotoAdapter is only a contract until an audited MIT codec is selected.

## Privacy and activation

Canvas redraw is intended to remove EXIF/GPS; byte scans, dimensions and injected-encoder tests describe this contract.
Actual image decoding, orientation, metadata removal and mobile UI require later browser/device checks. Consent names
Anthropic and retained hashes/identification. Thirty-day ledger retention requires operator purge; feedback has no
scheduled purge. The photo set, disclosure, provider policy and retention operations require owner review before live use.
