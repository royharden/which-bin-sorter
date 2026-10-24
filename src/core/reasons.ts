// The seven abstention reason codes, exactly (spec MVP item 5; PLAN.md 4.4).

export const REASON_CODES = [
  "no_candidate",
  "low_confidence",
  "ambiguous_bins",
  "multiple_items",
  "poor_image",
  "ask_council_rule",
  "unknown_condition",
] as const;

export type ReasonCode = (typeof REASON_CODES)[number];

export function isReasonCode(value: unknown): value is ReasonCode {
  return typeof value === "string" && (REASON_CODES as readonly string[]).includes(value);
}

/** Plain-language explanation shown on an abstain card. Never names a bin. */
export const REASON_COPY: Readonly<Record<ReasonCode, string>> = {
  no_candidate: "We could not match this to an item in the local rules table.",
  low_confidence: "We are not confident enough about what this item is.",
  ambiguous_bins: "It looks like two different items that are handled differently.",
  multiple_items: "There seems to be more than one item. Photograph one item at a time.",
  poor_image: "The photo is too blurry, dark or covered to identify the item.",
  ask_council_rule: "The local rules say to ask the council about this item.",
  unknown_condition: "The answer depends on a detail we could not confirm.",
};
