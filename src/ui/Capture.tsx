import type { ChangeEvent } from "react";
export function Capture({ onPhoto, disabled }: { onPhoto: (file: File) => void; disabled: boolean }) {
  function changed(event: ChangeEvent<HTMLInputElement>): void {
    const file = event.target.files?.[0];
    if (file !== undefined) onPhoto(file);
    event.target.value = "";
  }
  return <section className="capture" aria-labelledby="capture-heading">
    <div className="capture-art" aria-hidden="true"><span className="viewfinder">▣</span><span className="leaf">✦</span></div>
    <h2 id="capture-heading">One item. A little more clarity.</h2><p>Place a single household item in good light, with its label visible.</p>
    <label className={`upload-button${disabled ? " disabled" : ""}`}>Take or choose a photo <span aria-hidden="true">↗</span>
      <input aria-label="Take or choose a photo" type="file" accept="image/jpeg,image/png,image/webp" capture="environment" disabled={disabled} onChange={changed} />
    </label><p className="upload-help">JPEG, PNG or WebP · up to 5 MB · one item at a time</p>
  </section>;
}
