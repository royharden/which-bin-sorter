import type { FeedbackRecord } from "../demo/feedbackSink.ts";
export function FeedbackLog({ records }: { records: readonly FeedbackRecord[] }) {
  return <details className="feedback-log"><summary>Demo feedback log ({records.length})</summary>
    <p>In memory for this session only. Demo, not saved. Reports never change the rules.</p>
    {records.length === 0 ? <p>No reports yet.</p> : <ol>{records.map((record) => <li key={record.feedback_id}>
      <strong>{record.outcome.item_id ?? "Unrecognized item"}</strong> · {record.kind} · {record.outcome.type}<br />
      <code>{record.feedback_id}</code>
    </li>)}</ol>}
  </details>;
}
