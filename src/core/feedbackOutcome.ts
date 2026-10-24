// The single named serializer for feedback outcomes (PLAN.md 4.4, 4.7). It copies an existing resolver result's
// bin; it never chooses one. Feedback is an untrusted user report and never edits the rules table.
import type { ReasonCode } from "./reasons.ts";
import type { ResolveResult } from "./resolve.ts";

export interface FeedbackOutcome {
  type: "answer" | "clarify" | "abstain";
  item_id?: string;
  /** Copied from an `answer` result, as a plain string. */
  bin?: string;
  reason_code?: ReasonCode;
  rule_id?: string;
}

export function serializeFeedbackOutcome(result: ResolveResult): FeedbackOutcome {
  switch (result.type) {
    case "answer":
      return { type: "answer", item_id: result.item_id, bin: result.bin, rule_id: result.rule_id };
    case "clarify":
      return { type: "clarify", item_id: result.item_id };
    case "abstain": {
      const out: FeedbackOutcome = { type: "abstain", reason_code: result.reason };
      if (result.item_id !== null) out.item_id = result.item_id;
      if (result.rule_id !== null) out.rule_id = result.rule_id;
      return out;
    }
  }
}
