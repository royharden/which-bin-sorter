import { useId, useState } from "react";
import type { RulesFile } from "../core/rules.ts";
import { searchItems } from "../core/search.ts";

export function TypedSearch({ rules, onSelect, changing = false, disabled = false }: {
  rules: RulesFile; onSelect: (itemId: string) => void; changing?: boolean; disabled?: boolean;
}) {
  const [query, setQuery] = useState("");
  const id = useId();
  const result = searchItems(rules, query);
  const ids = result.kind === "exact" ? [result.entry_id] : result.kind === "candidates" ? result.entry_ids : [];
  return <section className="typed-search" aria-labelledby={`${id}-heading`}>
    <h2 id={`${id}-heading`}>{changing ? "Choose the correct item" : "Or, type the item"}</h2>
    <p className="muted">Search the local rules. No photo or model call needed.</p>
    <label htmlFor={id}>Item name</label><div className="search-field"><span aria-hidden="true">⌕</span>
      <input id={id} type="search" value={query} disabled={disabled} autoComplete="off" placeholder="Try cardboard box or aerosol…"
        onChange={(event) => setQuery(event.target.value)} aria-describedby={`${id}-hint`} /></div>
    <p id={`${id}-hint`} className="search-hint">Pick a match to check its condition.</p>
    {query.trim() !== "" && (ids.length === 0 ? <p role="status">No matching item in this table. Check council guidance or try another name.</p> :
      <ul className="search-results" aria-label="Matching items">{ids.map((itemId) => {
        const entry = rules.entries.find((item) => item.id === itemId);
        return <li key={itemId}><button disabled={disabled} onClick={() => { onSelect(itemId); setQuery(""); }}>
          <span>{entry?.name ?? itemId}</span><span aria-hidden="true">↗</span></button></li>;
      })}</ul>)}
  </section>;
}
