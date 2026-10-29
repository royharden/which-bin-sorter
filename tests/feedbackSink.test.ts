import { describe, expect, it, vi } from "vitest";
import { DemoFeedbackSink, LiveFeedbackSink, feedbackRecord } from "../src/demo/feedbackSink.ts";
import { emptyAttributes } from "../src/core/attributes.ts";
import { resolve } from "../src/core/resolve.ts";
import { serializeFeedbackOutcome } from "../src/core/feedbackOutcome.ts";
import { fixtureRules, TEST_RULES_VERSION, TEST_THRESHOLDS } from "./helpers/fixtureRules.ts";

function report() {
  const result = resolve({ mode: "selected", rules: fixtureRules(), rulesVersion: TEST_RULES_VERSION,
    thresholds: TEST_THRESHOLDS, item_id: "cardboard_box", attributes: emptyAttributes() });
  return { record: feedbackRecord(result, "31000000-0000-4000-8000-000000000002", null, null), result };
}
describe("feedback receipts and idempotency", () => {
  it("copies only the resolver outcome through the named serializer and appends once", async () => {
    const { record, result } = report();
    expect(record.outcome).toEqual(serializeFeedbackOutcome(result));
    expect(record.identify_request_id).toBeNull();
    const sink = new DemoFeedbackSink();
    expect(await sink.submit(record)).toEqual({ ok: true, label: "demo, not saved" });
    await Promise.all([sink.submit(record), sink.submit(record)]);
    expect(sink.records).toHaveLength(1);
    expect(sink.records[0]).toEqual(record);
  });
  it("live says saved only after a matching server confirmation", async () => {
    const { record } = report();
    const invoke = vi.fn().mockResolvedValue({ ok: true, saved: true, feedback_id: "wrong-id" });
    const sink = new LiveFeedbackSink({ invoke });
    expect(await sink.submit(record)).toEqual({ ok: false, label: "not saved; retry" });
    invoke.mockResolvedValue({ ok: false, code: "rate_limited" });
    expect(await sink.submit(record)).toEqual({ ok: false, label: "not saved; retry" });
    invoke.mockRejectedValue(new Error("offline"));
    expect(await sink.submit(record)).toEqual({ ok: false, label: "not saved; retry" });
    invoke.mockResolvedValue({ ok: true, saved: true, feedback_id: record.feedback_id });
    expect(await sink.submit(record)).toEqual({ ok: true, label: "saved" });
    expect(invoke.mock.calls.every((call) => JSON.stringify(call[0]) === JSON.stringify({ op: "feedback", ...record }))).toBe(true);
    expect(sink.records).toEqual([]);
  });
});
