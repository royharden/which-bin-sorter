# Rules sources

## Bundled Fixture City

`fixture-city.json` contains 34 invented entries, not a municipality's disposal advice. `source.kind` is `fixture`,
URLs are reserved `https://fixture-city.example.invalid/...` placeholders and `verified_by` is `fixture-generator`.
`verified_on` / `retrieved_on` = 2026-10-24 record fixture creation only. No council source was fetched or verified.

## Real locality activation template

Roy must name one council publishing an item-by-item list. Record the following before curating 60–80 entries:

| Field | Pending value |
|---|---|
| Council / locality id | Not selected |
| Authoritative published list URL | Not selected |
| Terms/licence URL and reviewed date | Not reviewed |
| Permission to reuse facts / paraphrasing policy | Not assessed |
| Human verifier and retrieval/verification dates | Not assigned |

Paraphrase facts; do not copy protected wording or scrape. Each entry needs its precise URL/section, verified_by,
retrieved_on and verified_on. Preserve condition priority, prep and council exceptions. Release validation rejects
fixture markers, example.invalid, fixture-generator and stale sources. Run later:

```sh
npx tsx scripts/validate-rules.ts rules/<locality>.json --mode release --stale fail --today <YYYY-MM-DD>
```

Update the browser-loaded rules, generated item-id list, rule catalog and parity tests together; source/prep edits
change the runtime rules hash. Review changes as commits, never accept feedback as a rules edit. No real source
terms or council verification is claimed by this template.
