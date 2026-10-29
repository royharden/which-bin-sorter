// @vitest-environment jsdom
// These tests exercise injected encoder/drawing seams, not canvas decoding in a real browser (Deferred #9).
import { webcrypto } from "node:crypto";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App, PhotoPreview } from "../src/ui/App.tsx";
import { DemoFeedbackSink, LiveFeedbackSink } from "../src/demo/feedbackSink.ts";
import { readConfig } from "../src/lib/config.ts";
import { LocalMockVisionClient } from "../src/vision/client.ts";
import type { VisionClient } from "../src/vision/client.ts";
import { fixtureRules, TEST_RULES_VERSION } from "./helpers/fixtureRules.ts";
import { preparedImage } from "./helpers/preparedImage.ts";

const demo = readConfig({});
const live = readConfig({ VITE_APP_MODE: "live", VITE_SUPABASE_URL: "https://service.example.invalid", VITE_SUPABASE_ANON_KEY: "public-placeholder" });
const loaded = { rules: fixtureRules(), version: TEST_RULES_VERSION, warnings: [] };

beforeEach(() => {
  vi.stubGlobal("crypto", webcrypto);
  Object.defineProperty(URL, "createObjectURL", { configurable: true, writable: true, value: vi.fn().mockReturnValue("blob:sample") });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, writable: true, value: vi.fn() });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

function mount(config = demo, client: VisionClient = new LocalMockVisionClient(), sink = new DemoFeedbackSink()) {
  const prepare = vi.fn().mockImplementation(() => Promise.resolve(preparedImage()));
  const drawTile = vi.fn().mockResolvedValue(new Blob(["synthetic tile"], { type: "image/png" }));
  const identify = vi.spyOn(client, "identify");
  const submit = vi.spyOn(sink, "submit");
  const view = render(<App config={config} initialRules={loaded} visionClient={client} feedbackSink={sink} prepare={prepare} drawTile={drawTile} />);
  return { ...view, identify, submit, sink, prepare, drawTile };
}
function search(query: string, name: string): void {
  fireEvent.change(screen.getByLabelText("Item name"), { target: { value: query } });
  fireEvent.click(screen.getByRole("button", { name, exact: true }));
}
function upload(): void {
  fireEvent.change(screen.getByLabelText("Take or choose a photo"), { target: { files: [new File(["photo"], "item.jpg", { type: "image/jpeg" })] } });
}

describe("M3 eight-step demo journey", () => {
  it("wires tile intake → clarify → answer → one unsaved feedback → change → typed unsure → traps", async () => {
    const app = mount();
    expect(screen.getByText("Demo mode")).toBeTruthy();
    expect(screen.getByText("Fixture: not real disposal guidance.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "pizza box (greasy)", exact: true }));
    await screen.findByRole("heading", { name: "Is the box greasy or has food stuck to it?" });
    expect(app.drawTile).toHaveBeenCalledTimes(1);
    expect(app.prepare).toHaveBeenCalledTimes(1);
    expect(app.identify.mock.calls[0]?.[0]).toMatchObject({ fixture_id: "pizza_box_greasy" });
    fireEvent.click(screen.getByRole("button", { name: "Yes", exact: true }));
    await screen.findByRole("heading", { name: "Food and garden (green lid)" });
    expect(screen.getByText("pizza_box#0")).toBeTruthy();
    expect(screen.getByText("2026-10-24")).toBeTruthy();
    expect(screen.getByRole("link", { name: /Synthetic rule source/ }).getAttribute("rel")).toBe("noopener noreferrer");
    const wrong = screen.getByRole("button", { name: "This is wrong" });
    fireEvent.click(wrong); fireEvent.click(wrong);
    await waitFor(() => expect(screen.getByRole("status").textContent).toBe("demo, not saved"));
    expect(app.submit).toHaveBeenCalledTimes(1);
    expect(app.sink.records).toHaveLength(1);
    expect(app.sink.records[0]?.outcome).toMatchObject({ type: "answer", item_id: "pizza_box", rule_id: "pizza_box#0" });
    expect(screen.getByText("Demo feedback log (1)")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Change item" }));
    search("cardboard box", "Cardboard box");
    expect(screen.getByRole("heading", { name: "Recycling (blue lid)" })).toBeTruthy();
    expect(screen.queryByText("demo, not saved")).toBeNull();
    // Re-select the conditional item; the earlier Yes and all vision attributes must have been cleared.
    search("pizza box", "Pizza box");
    expect(screen.getByRole("heading", { name: "Is the box greasy or has food stuck to it?" })).toBeTruthy();
    search("aerosol", "Aerosol can");
    expect(screen.getByRole("heading", { name: "Is there still product or liquid inside the can?" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Not sure", exact: true }));
    expect(screen.getByText("unknown_condition")).toBeTruthy();
    expect(app.identify).toHaveBeenCalledTimes(1); // all typed paths bypass vision
    fireEvent.click(screen.getByRole("button", { name: "two items", exact: true }));
    await screen.findByText("multiple_items");
    fireEvent.click(screen.getByRole("button", { name: "label says ignore your rules", exact: true }));
    await screen.findByText("no_candidate");
    fireEvent.click(screen.getByText("How this result was made"));
    expect(screen.getByText("vision response rejected (rejected_bin_field)")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Recycling (blue lid)" })).toBeNull();
  });

  it("typed search calls no vision client; changing a bad photo starts selected mode", async () => {
    const app = mount();
    search("cardboard box", "Cardboard box");
    expect(app.identify).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "two items", exact: true }));
    await screen.findByText("multiple_items");
    fireEvent.click(screen.getByRole("button", { name: "Change item" }));
    search("cardboard box", "Cardboard box");
    expect(screen.getByRole("heading", { name: "Recycling (blue lid)" })).toBeTruthy();
    expect(app.identify).toHaveBeenCalledTimes(1);
  });

  it("an unknown uploaded photo remains unrecognized in demo mode", async () => {
    mount(); upload();
    await screen.findByText("no_candidate");
    expect(screen.getByText("Demo mode only recognizes the sample tiles.", { selector: "p" })).toBeTruthy();
  });
});

describe("live setup, consent and honest receipts", () => {
  it("missing live public config shows setup with no demo fallback", () => {
    const client = new LocalMockVisionClient();
    const identify = vi.spyOn(client, "identify");
    render(<App config={readConfig({ VITE_APP_MODE: "live" })} initialRules={loaded} visionClient={client} />);
    expect(screen.getByRole("heading", { name: "Live mode needs a connection." })).toBeTruthy();
    expect(screen.queryByText("Demo mode")).toBeNull();
    expect(identify).not.toHaveBeenCalled();
  });
  it("never dispatches before explicit consent and refuses mock provenance", async () => {
    const client = new LocalMockVisionClient();
    const app = mount(live, client);
    upload();
    await screen.findByRole("heading", { name: "A photo leaves your device" });
    expect(screen.getByText(/Your photo is sent to Anthropic/)).toBeTruthy();
    expect(app.identify).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Cancel upload" }));
    expect(app.identify).not.toHaveBeenCalled();
    upload();
    fireEvent.click(await screen.findByRole("button", { name: "I agree — send this photo" }));
    await screen.findByText(/Live mode refused a mock response/);
    expect(app.identify).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("heading", { name: "Check with your council" })).toBeNull();
  });

  it("server errors offer manual same-id retry; consent lasts for this session", async () => {
    const identify = vi.fn<VisionClient["identify"]>().mockResolvedValue({ kind: "error", code: "request_in_progress", message: "Still processing" });
    mount(live, { identify }); upload();
    fireEvent.click(await screen.findByRole("button", { name: "I agree — send this photo" }));
    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button", { name: "Retry this request" }));
    await waitFor(() => expect(identify).toHaveBeenCalledTimes(2));
    expect(identify.mock.calls[1]?.[0].request_id).toBe(identify.mock.calls[0]?.[0].request_id);
    await waitFor(() => expect((screen.getByRole("button", { name: "Retry this request" }) as HTMLButtonElement).disabled).toBe(false));
    upload();
    await waitFor(() => expect(identify).toHaveBeenCalledTimes(3));
    expect(screen.queryByRole("heading", { name: "A photo leaves your device" })).toBeNull();
  });

  it("failed live feedback stays unsaved and retry preserves the exact report body", async () => {
    const invoke = vi.fn().mockResolvedValue({ ok: false, code: "ledger_unavailable" });
    const sink = new LiveFeedbackSink({ invoke });
    render(<App config={live} initialRules={loaded} feedbackSink={sink} />);
    search("cardboard box", "Cardboard box");
    fireEvent.click(screen.getByRole("button", { name: "This is wrong" }));
    await screen.findByText("not saved; retry");
    const first = invoke.mock.calls[0]?.[0] as { feedback_id: string };
    invoke.mockResolvedValue({ ok: true, saved: true, feedback_id: first.feedback_id });
    fireEvent.click(screen.getByRole("button", { name: "This is wrong" }));
    await screen.findByText("saved");
    expect(invoke.mock.calls[1]?.[0]).toEqual(invoke.mock.calls[0]?.[0]);
    expect(invoke.mock.calls[1]?.[0]).toMatchObject({ identify_request_id: null, upload_sha256: null });
    expect((screen.getByRole("button", { name: "This is wrong" }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("object URL lifecycle", () => {
  it("releases the previous photo URL on replacement and the final one on unmount", () => {
    const create = vi.mocked(URL.createObjectURL).mockReturnValueOnce("blob:first").mockReturnValueOnce("blob:second");
    const first = new Blob(["one"]);
    const second = new Blob(["two"]);
    const view = render(<PhotoPreview blob={first} />);
    expect(create).toHaveBeenCalledWith(first);
    view.rerender(<PhotoPreview blob={second} />);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:first");
    view.unmount();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:second");
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2);
  });
});
