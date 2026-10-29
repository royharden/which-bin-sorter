import { serializeFeedbackOutcome } from "../core/feedbackOutcome.ts";
import type { FeedbackOutcome } from "../core/feedbackOutcome.ts";
import type { ResolveResult } from "../core/resolve.ts";
import type { EdgeTransport } from "../lib/supabase.ts";

export interface FeedbackRecord {
  readonly feedback_id: string;
  readonly identify_request_id: string | null;
  readonly kind: "wrong_bin" | "wrong_item" | "other";
  readonly upload_sha256: string | null;
  readonly outcome: FeedbackOutcome;
  readonly rules_version: string;
}
export type FeedbackReceipt = { readonly ok: true; readonly label: "demo, not saved" | "saved" } | { readonly ok: false; readonly label: "not saved; retry" };
export interface FeedbackSink {
  submit(record: FeedbackRecord): Promise<FeedbackReceipt>;
  readonly records: readonly FeedbackRecord[];
}
export function feedbackRecord(result: ResolveResult, feedbackId: string, identifyId: string | null, uploadHash: string | null): FeedbackRecord {
  return { feedback_id: feedbackId, identify_request_id: identifyId, upload_sha256: uploadHash,
    kind: result.type === "answer" ? "wrong_bin" : "other", outcome: serializeFeedbackOutcome(result), rules_version: result.rules_version };
}
export class DemoFeedbackSink implements FeedbackSink {
  private readonly log = new Map<string, FeedbackRecord>();
  get records(): readonly FeedbackRecord[] { return [...this.log.values()]; }
  submit(record: FeedbackRecord): Promise<FeedbackReceipt> {
    // One immutable record per report id, including repeated clicks or retries.
    if (!this.log.has(record.feedback_id)) this.log.set(record.feedback_id, structuredClone(record));
    return Promise.resolve({ ok: true, label: "demo, not saved" });
  }
}
export class LiveFeedbackSink implements FeedbackSink {
  readonly records: readonly FeedbackRecord[] = [];
  readonly transport: EdgeTransport;
  constructor(transport: EdgeTransport) { this.transport = transport; }
  async submit(record: FeedbackRecord): Promise<FeedbackReceipt> {
    try {
      const raw: unknown = await this.transport.invoke({ op: "feedback", ...record });
      if (typeof raw === "object" && raw !== null && "ok" in raw && raw.ok === true &&
          "saved" in raw && raw.saved === true && "feedback_id" in raw && raw.feedback_id === record.feedback_id) return { ok: true, label: "saved" };
    } catch { /* The receipt remains unsaved. A user retry reuses the same feedback_id and body. */ }
    return { ok: false, label: "not saved; retry" };
  }
}
