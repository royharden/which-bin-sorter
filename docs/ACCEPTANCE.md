# Static construction acceptance map

All eleven spec items are mapped below. **Source-written / source-reviewed is not a passing executed check.**
No install, test, typecheck, lint, build, generator, browser, database or paid model call has run. Each construction
package receives a separate source review. Commands and operational checks are in DEFERRED-VALIDATION.md.

| Spec item | Implementation and written evidence | Current disposition / later check |
|---|---|---|
| 1 Rules validator/planted bad entry | rules/fixture-city.json, rules.schema.json; src/core/validateRules.ts; scripts/validate-rules.ts; tests/validateRules.test.ts, fixtureCity.test.ts | Source-reviewed; validator/schema/test execution pending (#1, M1-1, M1-5, M1-6); real table pending #15 |
| 2 Bin-free vision/only resolver emits bin | identify/visionSchema.ts; src/core/resolve.ts; tests/visionSchema.test.ts; tests/static/only-resolver-selects-bins.test.ts and import-boundaries.test.ts | Source-reviewed; AST/schema tests pending; syntactic guard limits documented |
| 3 Answer/clarify/seven reasons | src/core/{resolve,reasons,attributes}.ts; tests/resolve.test.ts, attributes.test.ts | Source-reviewed; tests pending M1-1 |
| 4 Intake/EXIF | src/intake/{sniff,reencode,hashes}.ts; tests/sniff.test.ts, reencode.test.ts, hashes.test.ts | Source-reviewed; injected contract tests pending M3-1; real browser/device metadata check #9/#10/M3-5 |
| 5 No-network mocks/injection | identify/providers/mock.ts, mockResponses.ts; src/vision/{client,normalize}.ts; tests/visionClient.test.ts, App.journey.test.tsx | Source-reviewed; demo/component execution pending M3; real injection outcome pending #18 |
| 6 RLS/budget before paid calls | supabase/migrations/20261024000100 through 00400; identify/{handler,ledger}.ts; tests/handler.test.ts | Source-reviewed; SQL application/RLS/concurrency pending #4–#8/M2-9; no deployed proof |
| 7 env/Bolt/tsc/eslint/vitest | .env.example, BOLT-HANDOFF.md, package.json, tsconfig*, eslint.config.js, vitest.config.ts | Files written; every install/type/lint/test/build check pending #1–#3, no lockfile |
| 8 Eval report/cache/Wilson | scripts/eval.ts, scripts/eval/report.ts; src/evalkit; eval/fixtures; tests/wilson.test.ts, eval.offline.test.ts, evalCache.test.ts, eval.preflight.test.ts | Source-reviewed; first offline execution pending M4-3; fixture metrics not real accuracy |
| 9 Real dev/heldout/named failures/cost | scripts/tune-thresholds.ts, prep-photos.ts, eval.ts; docs/LIMITATIONS.md template | Live-only deferred #13/#16–#19/M4-5–M4-9; not measured |
| 10 README locality/version/mock/Jev/agent authorship | README.md; rules/SOURCES.md; src/core/rulesVersion.ts | Documentation written; real council not selected, hash runtime-computed, Jev excluded |
| 11 Typed/correction/feedback/disclaimer/rate/ledger | src/ui, src/demo/feedbackSink.ts, src/core/feedbackOutcome.ts, identify/handler.ts; tests/TypedSearch.test.tsx, App.journey.test.tsx, ResultCard.test.tsx, feedbackSink.test.ts, handler.test.ts | Source-reviewed; component/handler tests pending M3-1/M3-2, SQL feedback race check M2-9; no runtime receipts |

Construction includes all five internal candidate-reuse areas: rulestable, cited, providers, callledger and evalkit.
The core measurable product claim is still untested. No acceptance item is silently upgraded to runtime-passed.
