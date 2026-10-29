import { describe, expect, it, vi } from "vitest";
import { closedListHash } from "../supabase/functions/identify/closedList.ts";
import { ITEM_IDS } from "../supabase/functions/identify/itemIds.generated.ts";
import { MOCK_RESPONSES } from "../supabase/functions/identify/mockResponses.ts";
import { EdgeVisionClient, LocalMockVisionClient } from "../src/vision/client.ts";
import { preparedImage } from "./helpers/preparedImage.ts";

const input = { image: preparedImage(), request_id: "31000000-0000-4000-8000-000000000001" };
async function liveResponse() {
  return { ok: true, vision: MOCK_RESPONSES["cardboard_box"]?.response, provenance: "live:test-model", model_id: "test-model",
    prompt_version: "identify-v1", request_id: input.request_id, schema_version: 1, preprocessing_version: "jpeg-1024-v1",
    closed_list_hash: await closedListHash(ITEM_IDS), upload_sha256: input.image.upload_sha256, replayed: false, settlement_pending: false };
}
describe("vision clients", () => {
  it("demo uses authored fixtures, rejects injection, blanks labels, and unknown uploads abstain", async () => {
    const client = new LocalMockVisionClient();
    const spy = vi.spyOn(globalThis, "fetch");
    const pizza = await client.identify({ ...input, fixture_id: "pizza_box_greasy" });
    expect(pizza.kind).toBe("vision");
    if (pizza.kind === "vision") {
      expect(pizza.value.vision.free_label).toBe("");
      expect(pizza.value.attributes.food_soiled).toBeNull();
      expect(pizza.provenance).toBe("mock");
    }
    expect(await client.identify({ ...input, fixture_id: "injection_label" })).toMatchObject({ kind: "rejected", debug: expect.arrayContaining(["vision response rejected (rejected_bin_field)"]) });
    const unknown = await client.identify(input);
    if (unknown.kind !== "vision") throw new Error("Expected normalized unknown photo");
    expect(unknown.value.evidence.item_count).toBe(0);
    expect(unknown.debug.join(" ")).toContain("Demo mode only recognizes the sample tiles");
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
  it("live refuses mock provenance and mismatched photo/version metadata", async () => {
    const response = await liveResponse();
    const invoke = vi.fn().mockResolvedValue({ ...response, provenance: "mock", model_id: null });
    const client = new EdgeVisionClient({ invoke });
    expect(await client.identify(input)).toMatchObject({ kind: "error", code: "mock_provenance" });
    for (const override of [{ upload_sha256: "c".repeat(64) }, { schema_version: 2 }, { closed_list_hash: "d".repeat(64) }, { request_id: "wrong" }, { preprocessing_version: "other" }]) {
      invoke.mockResolvedValue({ ...response, ...override });
      expect(await client.identify(input)).toMatchObject({ kind: "error", code: "version_mismatch" });
    }
  });
  it("validates live output, maps server rejection, and preserves settlement/replay warnings", async () => {
    const response = await liveResponse();
    const invoke = vi.fn().mockResolvedValue({ ...response, replayed: true, settlement_pending: true });
    const client = new EdgeVisionClient({ invoke });
    const value = await client.identify(input);
    expect(value.kind).toBe("vision");
    if (value.kind === "vision") expect(value.debug.join(" ")).toContain("settlement pending");
    expect(invoke).toHaveBeenCalledWith(expect.objectContaining({ request_id: input.request_id, schema_version: 1 }));
    expect(invoke.mock.calls[0]?.[0]).not.toHaveProperty("fixture_id");
    invoke.mockResolvedValue({ ok: false, code: "invalid_vision_output", detail: "rejected_bin_field" });
    expect(await client.identify(input)).toMatchObject({ kind: "rejected", debug: ["vision response rejected (rejected_bin_field)"] });
    invoke.mockResolvedValue({ ...response, vision: MOCK_RESPONSES["injection_label"]?.response });
    expect(await client.identify(input)).toMatchObject({ kind: "rejected" });
  });
  it("surfaces budget/network errors without retrying or manufacturing vision", async () => {
    const invoke = vi.fn().mockResolvedValue({ ok: false, code: "budget_exhausted" });
    const client = new EdgeVisionClient({ invoke });
    expect(await client.identify(input)).toMatchObject({ kind: "error", code: "budget_exhausted" });
    expect(invoke).toHaveBeenCalledTimes(1);
    invoke.mockRejectedValue(new Error("network"));
    expect(await client.identify(input)).toMatchObject({ kind: "error", code: "network_error" });
    expect(invoke).toHaveBeenCalledTimes(2);
  });
});
