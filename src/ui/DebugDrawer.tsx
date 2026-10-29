export function DebugDrawer({ notes, requestId }: { notes: readonly string[]; requestId: string | null }) {
  return <details className="debug-drawer"><summary>How this result was made</summary>
    <ul>{notes.map((note, index) => <li key={`${index}-${note}`}>{note}</li>)}</ul>
    {requestId !== null && <p>Request ID: <code>{requestId}</code></p>}
    <p>The model identifies an item. Only the deterministic rules resolver selects a bin. Accuracy comparisons are not yet measured.</p>
  </details>;
}
