import { useEffect, useMemo, useRef, useState } from "react";
import { applyClarifyAnswer, changeItemAttributes, fromVision } from "../core/attributes.ts";
import type { ClarifyAnswer, ResolvedAttributes } from "../core/attributes.ts";
import { loadFixtureCity } from "../core/loadRules.ts";
import type { LoadedRules } from "../core/loadRules.ts";
import { resolve } from "../core/resolve.ts";
import type { VisionEvidence } from "../core/resolve.ts";
import { DEFAULT_THRESHOLDS } from "../core/thresholds.ts";
import { DemoFeedbackSink, LiveFeedbackSink, feedbackRecord } from "../demo/feedbackSink.ts";
import type { FeedbackRecord, FeedbackSink } from "../demo/feedbackSink.ts";
import { DEMO_TILES, drawDemoTile } from "../demo/tiles.ts";
import type { DemoTile } from "../demo/tiles.ts";
import { prepareImage } from "../intake/reencode.ts";
import type { PreparedImage } from "../intake/reencode.ts";
import { APP_CONFIG } from "../lib/config.ts";
import type { AppConfig } from "../lib/config.ts";
import { createPublicClient, edgeTransport } from "../lib/supabase.ts";
import { EdgeVisionClient, LocalMockVisionClient } from "../vision/client.ts";
import type { IdentifyInput, ResultProvenance, VisionClient } from "../vision/client.ts";
import { Capture } from "./Capture.tsx";
import { DebugDrawer } from "./DebugDrawer.tsx";
import { DemoBanner } from "./DemoBanner.tsx";
import { FeedbackLog } from "./FeedbackLog.tsx";
import { FixtureBanner } from "./FixtureBanner.tsx";
import { LiveConsent } from "./LiveConsent.tsx";
import { ResultCard } from "./ResultCard.tsx";
import { SetupScreen } from "./SetupScreen.tsx";
import { TypedSearch } from "./TypedSearch.tsx";

type Selection = { readonly attributes: ResolvedAttributes } & (
  | { readonly mode: "vision"; readonly vision: VisionEvidence }
  | { readonly mode: "selected"; readonly item_id: string }
);
interface AppProps {
  config?: AppConfig;
  initialRules?: LoadedRules;
  visionClient?: VisionClient;
  feedbackSink?: FeedbackSink;
  prepare?: (blob: Blob) => Promise<PreparedImage>;
  drawTile?: (tile: DemoTile) => Promise<Blob>;
}

export function PhotoPreview({ blob }: { blob: Blob }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    const next = URL.createObjectURL(blob);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [blob]);
  return url === null ? null : <img className="photo-preview" src={url} alt="Resized photo of your item" />;
}

export function App({ config = APP_CONFIG, initialRules, visionClient, feedbackSink,
  prepare = prepareImage, drawTile = drawDemoTile }: AppProps) {
  const [loaded, setLoaded] = useState<LoadedRules | null>(initialRules ?? null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [provenance, setProvenance] = useState<ResultProvenance>("typed · local rules");
  const [debug, setDebug] = useState<readonly string[]>([]);
  const [photo, setPhoto] = useState<IdentifyInput | null>(null);
  const [pendingConsent, setPendingConsent] = useState<IdentifyInput | null>(null);
  const [consented, setConsented] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [changing, setChanging] = useState(false);
  const [feedbackLabel, setFeedbackLabel] = useState<string | null>(null);
  const [feedbackDisabled, setFeedbackDisabled] = useState(false);
  const [demoRecords, setDemoRecords] = useState<readonly FeedbackRecord[]>([]);
  const generation = useRef(0);
  const photoBusy = useRef(false);
  const feedbackBusy = useRef(false);
  const report = useRef<FeedbackRecord | null>(null);
  const searchTarget = useRef<HTMLDivElement>(null);

  const services = useMemo(() => {
    if (config.mode === "demo") return { vision: visionClient ?? new LocalMockVisionClient(), feedback: feedbackSink ?? new DemoFeedbackSink() };
    const client = createPublicClient(config);
    if (client === null) return { vision: null, feedback: null };
    const transport = edgeTransport(client);
    return { vision: visionClient ?? new EdgeVisionClient(transport), feedback: feedbackSink ?? new LiveFeedbackSink(transport) };
  }, [config, visionClient, feedbackSink]);

  useEffect(() => {
    let cancelled = false;
    if (initialRules === undefined) {
      void loadFixtureCity().then((value) => { if (!cancelled) setLoaded(value); })
        .catch(() => { if (!cancelled) setLoadError("The rules table could not be loaded. Reload to try again; no disposal answer was selected."); });
    }
    return () => { cancelled = true; generation.current++; };
  }, [initialRules]);

  const result = useMemo(() => loaded !== null && selection !== null ? resolve({ ...selection,
    rules: loaded.rules, rulesVersion: loaded.version, thresholds: DEFAULT_THRESHOLDS }) : null, [loaded, selection]);

  function resetFeedback(): void {
    report.current = null;
    feedbackBusy.current = false;
    setFeedbackLabel(null);
    setFeedbackDisabled(false);
  }
  function freshJourney(): number {
    generation.current++;
    setSelection(null);
    setError(null);
    setDebug([]);
    setChanging(false);
    setPendingConsent(null);
    resetFeedback();
    return generation.current;
  }

  async function identify(input: IdentifyInput, token: number): Promise<void> {
    if (services.vision === null) return;
    setBusy(true);
    photoBusy.current = true;
    try {
      const response = await services.vision.identify(input);
      if (token !== generation.current) return;
      if (response.kind === "error") { setError(`${response.message} (${response.code})`); return; }
      // Injected clients obey the same live boundary as the production adapter.
      if (config.mode === "live" && response.provenance === "mock") {
        setError("Live mode refused a mock response. Check the function configuration."); return;
      }
      setProvenance(response.provenance);
      setDebug(response.debug);
      if (response.kind === "rejected") {
        setSelection({ mode: "vision", attributes: changeItemAttributes(),
          vision: { item_count: 0, candidates: [], image_quality: "good" } });
      } else {
        setSelection({ mode: "vision", attributes: fromVision(response.value.attributes), vision: response.value.evidence });
      }
    } catch { if (token === generation.current) setError("Identification could not finish. Retry this request or type the item."); }
    finally { if (token === generation.current) { setBusy(false); photoBusy.current = false; } }
  }

  async function beginPhoto(getBlob: () => Promise<Blob>, fixtureId?: string): Promise<void> {
    if (photoBusy.current || pendingConsent !== null) return;
    photoBusy.current = true;
    const token = freshJourney();
    setPhoto(null);
    setBusy(true);
    try {
      const image = await prepare(await getBlob());
      if (token !== generation.current) return;
      const input: IdentifyInput = { image, request_id: crypto.randomUUID(), ...(fixtureId === undefined ? {} : { fixture_id: fixtureId }) };
      setPhoto(input);
      if (config.mode === "live" && !consented) {
        setPendingConsent(input);
      } else { await identify(input, token); }
    } catch (caught) {
      if (token === generation.current) setError(caught instanceof Error ? caught.message : "Could not prepare this photo. Try another photo.");
    } finally { if (token === generation.current) { setBusy(false); photoBusy.current = false; } }
  }

  function selectItem(itemId: string): void {
    freshJourney();
    photoBusy.current = false;
    setBusy(false);
    setPhoto(null);
    setProvenance("typed · local rules");
    setDebug(["User selected an item. All photo evidence and previous condition answers were cleared. No vision client called."]);
    setSelection({ mode: "selected", item_id: itemId, attributes: changeItemAttributes() });
  }

  function clarify(answer: ClarifyAnswer): void {
    if (result?.type !== "clarify") return;
    resetFeedback();
    // Invalidate a feedback response from the previous result before accepting the new condition.
    generation.current++;
    setSelection((current) => current === null || current.attributes[result.attribute].source === "user" ? current :
      { ...current, attributes: applyClarifyAnswer(current.attributes, result.attribute, answer) });
  }

  async function sendFeedback(): Promise<void> {
    if (result === null || services.feedback === null || feedbackBusy.current) return;
    feedbackBusy.current = true;
    setFeedbackDisabled(true);
    setFeedbackLabel("Sending report…");
    const token = generation.current;
    const record = report.current ?? feedbackRecord(result, crypto.randomUUID(), photo?.request_id ?? null, photo?.image.upload_sha256 ?? null);
    report.current = record;
    try {
      const receipt = await services.feedback.submit(record);
      if (token !== generation.current) return;
      setFeedbackLabel(receipt.label);
      setFeedbackDisabled(receipt.ok);
      if (config.mode === "demo") setDemoRecords([...services.feedback.records]);
    } catch {
      if (token === generation.current) { setFeedbackLabel("not saved; retry"); setFeedbackDisabled(false); }
    } finally { if (token === generation.current) feedbackBusy.current = false; }
  }

  if (config.setupIssues.length > 0) return <SetupScreen issues={config.setupIssues} />;
  if (loadError !== null) return <main className="setup-screen"><h1>Which Bin?</h1><p role="alert">{loadError}</p></main>;
  if (loaded === null) return <main className="setup-screen" aria-busy="true"><h1>Which Bin?</h1><p role="status">Loading local rules…</p></main>;

  return <div className="app-shell">
    <header className="site-header"><a className="brand" href="#"><span className="brand-mark" aria-hidden="true">↻</span>Which Bin<span>?</span></a>
      <span className="location-pill"><span aria-hidden="true">⌾</span> {loaded.rules.locality.name}</span></header>
    {config.mode === "demo" ? <DemoBanner /> : <div className="mode-banner"><span className="status-dot" /><strong>Live mode</strong><span>Photo identification uses the configured service. Typed search stays local.</span></div>}
    <main>
      <section className="hero"><p className="eyebrow">Small everyday decisions, clearer answers</p><h1>A second look.<br /><span>A better sort.</span></h1>
        <p>Start with one item. We’ll check what it is, ask about the details that matter, and follow the local rules.</p></section>
      {loaded.rules.fixture && <FixtureBanner />}
      <div className="workspace"><div className="intake-column"><Capture disabled={busy || pendingConsent !== null}
        onPhoto={(file) => { void beginPhoto(() => Promise.resolve(file)); }} />
        <div ref={searchTarget}><TypedSearch rules={loaded.rules} onSelect={selectItem} changing={changing} disabled={busy || pendingConsent !== null} /></div>
      </div><div className="answer-column" aria-live="polite" aria-busy={busy}>
        {photo !== null && <PhotoPreview blob={photo.image.blob} />}
        {pendingConsent !== null && <LiveConsent onAccept={() => {
          if (photoBusy.current) return;
          setConsented(true); setPendingConsent(null); void identify(pendingConsent, generation.current);
        }} onCancel={() => { freshJourney(); setPhoto(null); }} />}
        {busy && <div className="working-state" role="status"><span className="loading-ring" />Preparing and checking your item…</div>}
        {error !== null && <section className="error-card" role="alert"><h2>We couldn’t finish that check</h2><p>{error}</p>
          <div className="button-row">{photo !== null && pendingConsent === null && <button className="secondary" disabled={busy}
            onClick={() => { if (!photoBusy.current) { setError(null); void identify(photo, generation.current); } }}>Retry this request</button>}
            <button className="text-button" onClick={() => { setChanging(true); searchTarget.current?.querySelector("input")?.focus(); }}>Type an item</button></div></section>}
        {result !== null && <ResultCard result={result} provenance={provenance} fixture={loaded.rules.fixture} onAnswer={clarify}
          onChange={() => { setChanging(true); searchTarget.current?.querySelector("input")?.focus(); }} onFeedback={() => { void sendFeedback(); }}
          feedbackLabel={feedbackLabel} feedbackDisabled={feedbackDisabled} />}
        {result?.type === "abstain" && selection?.mode === "vision" && config.mode === "demo" && photo !== null && photo.fixture_id === undefined &&
          <p className="muted">Demo mode only recognizes the sample tiles.</p>}
        {result === null && !busy && error === null && pendingConsent === null && <section className="empty-answer"><div className="empty-art" aria-hidden="true">↗</div>
          <p className="eyebrow">Good sorting starts here</p><h2>Give your item a little context.</h2><p>Take a photo or search by name. If a detail changes the answer, we’ll ask.</p>
          <div className="three-steps"><span>01 · Identify</span><span>02 · Clarify</span><span>03 · Check the rule</span></div></section>}
        {(result !== null || debug.length > 0) && <DebugDrawer notes={debug} requestId={photo?.request_id ?? null} />}
      </div></div>
      {config.mode === "demo" && <section className="demo-gallery" aria-labelledby="demo-heading"><div className="section-heading"><div><p className="eyebrow">Try the full journey</p>
        <h2 id="demo-heading">A few everyday test cases.</h2></div><p>Runtime drawings + authored mock responses.<br />No keys, network or real photographs.</p></div>
        <div className="tile-grid">{DEMO_TILES.map((tile) => <button key={tile.fixture_id} className="demo-tile" disabled={busy || pendingConsent !== null}
          onClick={() => { void beginPhoto(() => drawTile(tile), tile.fixture_id); }}><span className="tile-art" style={{ backgroundColor: tile.color }} aria-hidden="true">{tile.glyph}</span>
          <span>{tile.label}</span><span className="tile-arrow" aria-hidden="true">↗</span></button>)}</div>
        <FeedbackLog records={demoRecords} /></section>}
    </main><footer><span className="brand-small">Which Bin?</span><p>Rules before guesses. Accuracy comparisons are not yet measured.</p><span>Built by coding agents · Unverified construction</span></footer>
  </div>;
}
