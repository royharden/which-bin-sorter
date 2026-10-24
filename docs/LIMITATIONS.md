# Limitations — unmeasured template

**Not yet measured.** This is an authored template, not generated results. No evaluation, model request or test ran.
Fixture City is synthetic; the app provides no verified local disposal guidance. Thirty-four rule entries, authored
mock responses and canvas labels demonstrate intended pipeline paths, not recognition quality. Thresholds are placeholders.

There are 60 synthetic text queries, eight fixture-manifest cases and 32 authored cache files. The real council table,
200-query target, 120 licensed photo set, dev tuning and once-only heldout evaluation remain pending. CLIP is not run;
Jev is not evaluated / not included. No directional wrong-bin/contamination superiority claim is supported.

| Evidence | Status |
|---|---|
| Wrong answers by photo id/rule | Not measured; no real predictions |
| Wrong abstentions and clarifications | Not measured |
| Injection photo outcome | Live run pending; model can still affect ids/attributes |
| Same-subset baseline comparison, uncertainty, cost and latency | Not measured |
| Browser/canvas/EXIF, strict types, dependency compatibility | Unverified |
| SQL RLS, concurrency, trusted address, provider contract | Unverified |

Later generate a fresh reviewable limitations file alongside the report:

```sh
npm run eval -- --offline --fixture --split dev --out results/fixture-dev --limitations results/fixture-dev/LIMITATIONS.md
```

The CLI calls pure `buildLimitations` in `scripts/eval/report.ts` and refuses existing output paths. Fixture-generated
limitations remain authored-demo evidence. For real results use the approved live manifest/config and budget-gated
run, review the named-error list (including contamination and abstention), and promote verified findings here through
a reviewed commit. Keep incomplete runs labelled incomplete and unavailable comparisons explicit. See
[DEFERRED-VALIDATION.md](DEFERRED-VALIDATION.md) for exact activation steps.
