export function SetupScreen({ issues }: { issues: readonly string[] }) {
  return <main className="setup-screen"><div className="brand-mark" aria-hidden="true">↻</div><p className="eyebrow">Which Bin? · Setup</p>
    <h1>Live mode needs a connection.</h1><p>The app is configured for live identification. Add the public connection settings, then reload.</p>
    <ul>{issues.map((issue) => <li key={issue}>{issue}</li>)}</ul>
    <p>Server configuration, migrations, budget and provider setup must also be verified before activation. Use <code>VITE_APP_MODE=demo</code> for the local authored demo.</p>
  </main>;
}
