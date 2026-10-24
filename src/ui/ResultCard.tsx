import type { Citation } from "../core/cited.ts";
import { REASON_COPY } from "../core/reasons.ts";
import type { ResolveResult } from "../core/resolve.ts";
import type { ClarifyAnswer } from "../core/attributes.ts";
import type { ResultProvenance } from "../vision/client.ts";
import { ClarifyButtons } from "./ClarifyButtons.tsx";
import { Disclaimer } from "./Disclaimer.tsx";

function RuleCitation({ citation }: { citation: Citation }) {
  return <div className="citation"><a href={citation.url} target="_blank" rel="noopener noreferrer">
    {citation.source_kind === "fixture" ? "Synthetic rule source" : "Council rule source"} ↗</a>
    <dl><div><dt>Rule</dt><dd>{citation.rule_id}</dd></div><div><dt>Section</dt><dd>{citation.section}</dd></div>
      <div><dt>{citation.source_kind === "fixture" ? "Fixture date" : "Verified on"}</dt><dd>{citation.verified_on}</dd></div></dl>
  </div>;
}
export function ResultCard({ result, provenance, fixture, onAnswer, onChange, onFeedback, feedbackLabel, feedbackDisabled }: {
  result: ResolveResult; provenance: ResultProvenance; fixture: boolean;
  onAnswer: (answer: ClarifyAnswer) => void; onChange: () => void; onFeedback: () => void;
  feedbackLabel: string | null; feedbackDisabled: boolean;
}) {
  return <article className={`result-card result-${result.type}`} aria-labelledby="result-heading">
    <div className="result-topline"><span className="eyebrow">{result.type === "clarify" ? "One detail first" : result.type === "answer" ? "Rules table answer" : "Let’s check this carefully"}</span>
      <span className="provenance">{provenance}</span></div>
    {result.type === "answer" ? <>
      <p className="item-name">{result.item_name}</p><h2 id="result-heading">{result.bin_label}</h2>
      <p className="result-context">{fixture ? "Fixture City demonstration answer" : "For your selected locality"}</p>
      {result.prep_steps.length > 0 && <><h3>Before it goes</h3><ul className="prep-steps">{result.prep_steps.map((step) => <li key={step}>{step}</li>)}</ul></>}
      {result.instruction && <p>{result.instruction}</p>}<RuleCitation citation={result.citation} />
    </> : result.type === "clarify" ? <>
      <p className="item-name">{result.item_name}</p><h2 id="result-heading">{result.question}</h2>
      <p>It changes the answer in the local rules. If you can’t tell, choose “Not sure.”</p><ClarifyButtons onAnswer={onAnswer} />
    </> : <>
      <h2 id="result-heading">Check with your council</h2><p>{REASON_COPY[result.reason]}</p>
      {result.item_name !== null && <p className="item-name">Item: {result.item_name}</p>}
      <p className="reason-code">Reason: <code>{result.reason}</code></p>{result.instruction && <p>{result.instruction}</p>}
      {result.citation !== null && <RuleCitation citation={result.citation} />}
    </>}
    <p className="rules-version">Rules version <code title={result.rules_version}>{result.rules_version}</code></p>
    {result.type !== "clarify" && <Disclaimer councilUrl={result.council_url} fixture={fixture} />}
    <div className="result-actions"><button className="secondary" onClick={onChange}>Change item</button>
      <button className="text-button" disabled={feedbackDisabled} onClick={onFeedback}>This is wrong</button></div>
    {feedbackLabel !== null && <p className="feedback-receipt" role="status">{feedbackLabel}</p>}
  </article>;
}
