export const LIVE_CONSENT_COPY = "Your photo is sent to Anthropic to identify the item. This app does not store the photo; it keeps a fingerprint (hash) of the resized image and the identification for 30 days to prevent duplicate charges. Anthropic's own data policy applies to what it receives.";
export function LiveConsent({ onAccept, onCancel }: { onAccept: () => void; onCancel: () => void }) {
  return <section className="consent-card" aria-labelledby="consent-heading">
    <p className="eyebrow">Before sending your first photo</p><h2 id="consent-heading">A photo leaves your device</h2>
    <p>{LIVE_CONSENT_COPY}</p><p>Remove personal details from your photo. Consent lasts for this open app session.</p>
    <div className="button-row"><button className="primary" onClick={onAccept}>I agree — send this photo</button>
      <button className="secondary" onClick={onCancel}>Cancel upload</button></div>
  </section>;
}
