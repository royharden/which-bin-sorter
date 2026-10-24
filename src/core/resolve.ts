// Deterministic resolver (spec MVP item 4; PLAN.md 4.4). The ONLY module that may emit a bin.
// `ResolvedBin` values are created solely by the module-private `selectBin()` below; a static test
// (tests/static/only-resolver-selects-bins.test.ts) fails on any other brand creation or on exporting `selectBin`.
//
// Exit order (each exit has a reason code):
//  vision mode only: 1 multiple_items, 2 no_candidate, 3 poor_image, 4 low_confidence, 5 ambiguous_bins
//  both modes:       6 ask_council_rule (entry flag), 6b answer (unconditional entry),
//                    7 clarify (only when the reachable outcome set has more than one member),
//                    8a answer through the selected condition, 8b ask_council_rule (instruction-only condition),
//                    9 unknown_condition (no condition matches, or the outcome stays open after "Not sure").
import { ATTRIBUTE_ORDER, binLabel, findEntry, ruleIdFor } from "./rules.ts";
import type { Attr, BinId, Condition, RuleEntry, RulesFile } from "./rules.ts";
import { CLARIFY_OPTIONS, isExhausted } from "./attributes.ts";
import type { ClarifyAnswer, ResolvedAttributes } from "./attributes.ts";
import type { ReasonCode } from "./reasons.ts";
import type { Thresholds } from "./thresholds.ts";
import { citeRule } from "./cited.ts";
import type { Citation } from "./cited.ts";

/** A bin id that the resolver selected from the rules. Only `selectBin()` in this module creates one. */
export type ResolvedBin = string & { readonly __resolved: unique symbol };

export type ImageQuality = "good" | "blurry" | "dark" | "occluded";

export interface VisionCandidate {
  readonly item_id: string;
  readonly confidence: number;
}

/** The parts of a validated, normalized vision output the resolver gates on (bin-free by construction). */
export interface VisionEvidence {
  readonly item_count: number;
  readonly candidates: readonly VisionCandidate[];
  readonly image_quality: ImageQuality;
}

interface BaseInput {
  readonly rules: RulesFile;
  readonly rulesVersion: string;
  readonly attributes: ResolvedAttributes;
  readonly thresholds: Thresholds;
}

/** Photo identification: vision gates 1-5 apply; the item is the top valid candidate. */
export interface VisionModeInput extends BaseInput {
  readonly mode: "vision";
  readonly vision: VisionEvidence;
}

/** Typed path and Change item: the user chose the item; vision gates are skipped. */
export interface SelectedModeInput extends BaseInput {
  readonly mode: "selected";
  readonly item_id: string;
}

export type ResolveInput = VisionModeInput | SelectedModeInput;
export type ResolveMode = ResolveInput["mode"];

export interface AnswerResult {
  readonly type: "answer";
  readonly mode: ResolveMode;
  readonly item_id: string;
  readonly item_name: string;
  readonly bin: ResolvedBin;
  readonly bin_label: string;
  readonly prep_steps: readonly string[];
  /** Extra text from a condition that has both a bin and an instruction; null otherwise. */
  readonly instruction: string | null;
  readonly rule_id: string;
  readonly citation: Citation;
  readonly rules_version: string;
  readonly council_url: string;
}

export interface ClarifyResult {
  readonly type: "clarify";
  readonly mode: ResolveMode;
  readonly item_id: string;
  readonly item_name: string;
  readonly attribute: Attr;
  readonly question: string;
  readonly options: readonly ClarifyAnswer[];
  readonly rules_version: string;
  readonly council_url: string;
}

export interface AbstainResult {
  readonly type: "abstain";
  readonly mode: ResolveMode;
  readonly reason: ReasonCode;
  readonly item_id: string | null;
  readonly item_name: string | null;
  readonly rule_id: string | null;
  /** Instruction text of an instruction-only condition (8b); null otherwise. */
  readonly instruction: string | null;
  readonly citation: Citation | null;
  /** For `ambiguous_bins`: the two near-tied item ids (so the UI can offer Change item). Empty otherwise. */
  readonly candidate_ids: readonly string[];
  readonly rules_version: string;
  readonly council_url: string;
}

export type ResolveResult = AnswerResult | ClarifyResult | AbstainResult;

// ---------------------------------------------------------------------------------------------------------------
// Bin selection (module-private; never exported)

function selectBin(rules: RulesFile, binId: BinId): ResolvedBin {
  if (!rules.bins.some((bin) => bin.id === binId)) {
    throw new Error(`resolver: bin "${binId}" is not declared by the rules file`);
  }
  return binId as ResolvedBin;
}

// ---------------------------------------------------------------------------------------------------------------
// Condition evaluation

type Assignment = Partial<Record<Attr, boolean>>;

/** Conditioned attributes of an entry, in the fixed scan order. */
function conditionedAttributes(entry: RuleEntry): Attr[] {
  return ATTRIBUTE_ORDER.filter((attr) => entry.conditions.some((condition) => condition.when[attr] !== undefined));
}

function matches(condition: Condition, assignment: Assignment): boolean {
  return ATTRIBUTE_ORDER.every((attr) => {
    const wanted = condition.when[attr];
    return wanted === undefined || assignment[attr] === wanted;
  });
}

/** Step 8 selection: highest priority matching condition; ties go to the lower index. -1 = none matches. */
function selectCondition(entry: RuleEntry, assignment: Assignment): number {
  let best = -1;
  let bestPriority = Number.NEGATIVE_INFINITY;
  entry.conditions.forEach((condition, index) => {
    if (matches(condition, assignment) && condition.priority > bestPriority) {
      best = index;
      bestPriority = condition.priority;
    }
  });
  return best;
}

/** Known values for the entry's conditioned attributes, and the ones still null (open). */
function splitAttributes(entry: RuleEntry, attributes: ResolvedAttributes): { known: Assignment; open: Attr[] } {
  const known: Assignment = {};
  const open: Attr[] = [];
  for (const attr of conditionedAttributes(entry)) {
    const value = attributes[attr].value;
    if (value === null) open.push(attr);
    else known[attr] = value;
  }
  return { known, open };
}

/** Every condition index (or -1) reachable over all values of the open attributes. */
function reachableSelections(entry: RuleEntry, known: Assignment, open: readonly Attr[]): Set<number> {
  const reached = new Set<number>();
  const total = 1 << open.length;
  for (let mask = 0; mask < total; mask++) {
    const assignment: Assignment = { ...known };
    open.forEach((attr, bit) => {
      assignment[attr] = (mask & (1 << bit)) !== 0;
    });
    reached.add(selectCondition(entry, assignment));
  }
  return reached;
}

function sameSet<T>(a: ReadonlySet<T>, b: ReadonlySet<T>): boolean {
  if (a.size !== b.size) return false;
  for (const item of a) if (!b.has(item)) return false;
  return true;
}

/**
 * Bin-level outcome set of a candidate entry (step 5): reachable results of steps 6-9 over all values of its
 * currently-null attributes, as `answer:<bin>` | `abstain:<reason>` keys.
 */
function outcomeSet(entry: RuleEntry, attributes: ResolvedAttributes): Set<string> {
  if (entry.ask_council) return new Set(["abstain:ask_council_rule"]);
  if (entry.conditions.length === 0) {
    return new Set([entry.bin !== null ? `answer:${entry.bin}` : "abstain:unknown_condition"]);
  }
  const { known, open } = splitAttributes(entry, attributes);
  const out = new Set<string>();
  for (const index of reachableSelections(entry, known, open)) {
    const condition = index === -1 ? undefined : entry.conditions[index];
    if (condition === undefined) out.add("abstain:unknown_condition");
    else if (condition.bin !== undefined) out.add(`answer:${condition.bin}`);
    else out.add("abstain:ask_council_rule");
  }
  return out;
}

/** Outcomes differ unless both sets are the same single answer bin. */
function outcomesDiffer(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== 1 || b.size !== 1) return true;
  const [left] = [...a];
  const [right] = [...b];
  return !(left !== undefined && left === right && left.startsWith("answer:"));
}

// ---------------------------------------------------------------------------------------------------------------
// Result builders

function abstain(
  input: ResolveInput,
  reason: ReasonCode,
  entry: RuleEntry | null,
  extra: { rule_id?: string | null; instruction?: string | null; citation?: Citation | null; candidate_ids?: string[] } = {},
): AbstainResult {
  return {
    type: "abstain",
    mode: input.mode,
    reason,
    item_id: entry?.id ?? null,
    item_name: entry?.name ?? null,
    rule_id: extra.rule_id ?? null,
    instruction: extra.instruction ?? null,
    citation: extra.citation ?? null,
    candidate_ids: extra.candidate_ids ?? [],
    rules_version: input.rulesVersion,
    council_url: input.rules.locality.council_url,
  };
}

function answer(
  input: ResolveInput,
  entry: RuleEntry,
  binId: BinId,
  conditionIndex: number | null,
  prepSteps: readonly string[],
  instruction: string | null,
): AnswerResult {
  const bin = selectBin(input.rules, binId);
  return {
    type: "answer",
    mode: input.mode,
    item_id: entry.id,
    item_name: entry.name,
    bin,
    bin_label: binLabel(input.rules, binId) ?? binId,
    prep_steps: [...prepSteps],
    instruction,
    rule_id: ruleIdFor(entry.id, conditionIndex),
    citation: citeRule(entry, input.rulesVersion, conditionIndex),
    rules_version: input.rulesVersion,
    council_url: input.rules.locality.council_url,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Steps 6-9 for one entry (shared by both modes)

function resolveEntry(input: ResolveInput, entry: RuleEntry): ResolveResult {
  // 6: the rules say ask the council.
  if (entry.ask_council) {
    return abstain(input, "ask_council_rule", entry, {
      rule_id: ruleIdFor(entry.id, null),
      citation: citeRule(entry, input.rulesVersion, null),
    });
  }

  // 6b: unconditional entry.
  if (entry.conditions.length === 0) {
    if (entry.bin === null) return abstain(input, "unknown_condition", entry); // unreachable for a validated file
    return answer(input, entry, entry.bin, null, entry.prep_steps, null);
  }

  // 7: clarify only when more than one outcome (selected condition) is still reachable.
  const { known, open } = splitAttributes(entry, input.attributes);
  const reachable = reachableSelections(entry, known, open);
  if (reachable.size > 1) {
    for (const attr of open) {
      if (isExhausted(input.attributes[attr])) continue;
      const rest = open.filter((other) => other !== attr);
      const withTrue: Assignment = { ...known };
      withTrue[attr] = true;
      const withFalse: Assignment = { ...known };
      withFalse[attr] = false;
      const ifTrue = reachableSelections(entry, withTrue, rest);
      const ifFalse = reachableSelections(entry, withFalse, rest);
      if (!sameSet(ifTrue, reachable) || !sameSet(ifFalse, reachable)) {
        const question = entry.questions[attr];
        if (question === undefined) continue; // unreachable for a validated file (missing_question)
        return {
          type: "clarify",
          mode: input.mode,
          item_id: entry.id,
          item_name: entry.name,
          attribute: attr,
          question,
          options: CLARIFY_OPTIONS,
          rules_version: input.rulesVersion,
          council_url: input.rules.locality.council_url,
        };
      }
    }
    // Every attribute that could still change the outcome was answered "Not sure".
    return abstain(input, "unknown_condition", entry);
  }

  // 8/9: exactly one outcome is reachable, so the known attributes alone select it.
  const [selected] = [...reachable];
  const condition = selected === undefined || selected === -1 ? undefined : entry.conditions[selected];
  if (condition === undefined || selected === undefined) return abstain(input, "unknown_condition", entry);
  if (condition.bin !== undefined) {
    return answer(
      input,
      entry,
      condition.bin,
      selected,
      condition.prep_steps ?? entry.prep_steps,
      condition.instruction ?? null,
    );
  }
  return abstain(input, "ask_council_rule", entry, {
    rule_id: ruleIdFor(entry.id, selected),
    instruction: condition.instruction ?? null,
    citation: citeRule(entry, input.rulesVersion, selected),
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Public entry point

export function resolve(input: ResolveInput): ResolveResult {
  if (input.mode === "selected") {
    const entry = findEntry(input.rules, input.item_id);
    if (entry === undefined) return abstain(input, "no_candidate", null);
    return resolveEntry(input, entry);
  }

  const { vision, rules, thresholds } = input;

  // 1: more than one item in frame.
  if (vision.item_count > 1) return abstain(input, "multiple_items", null);

  // 2: nothing usable. Candidates whose id is not in the table are ignored; duplicates keep their best score.
  const sorted = vision.candidates
    .filter((c) => Number.isFinite(c.confidence) && (c.item_id === "none" || findEntry(rules, c.item_id) !== undefined))
    .sort((a, b) => b.confidence - a.confidence);
  const seen = new Set<string>();
  const candidates: VisionCandidate[] = [];
  for (const candidate of sorted) {
    if (seen.has(candidate.item_id)) continue;
    seen.add(candidate.item_id);
    candidates.push(candidate);
  }
  const top = candidates[0];
  if (vision.item_count === 0 || top === undefined || top.item_id === "none") return abstain(input, "no_candidate", null);
  const topEntry = findEntry(rules, top.item_id);
  if (topEntry === undefined) return abstain(input, "no_candidate", null);

  // 3: image quality.
  if (vision.image_quality !== "good") return abstain(input, "poor_image", null);

  // 4: confidence.
  if (top.confidence < thresholds.t_low) return abstain(input, "low_confidence", topEntry);

  // 5: near-tie between two real items whose outcomes differ. Always abstain; never a cross-item question.
  const second = candidates[1];
  if (second !== undefined && second.item_id !== "none" && top.confidence - second.confidence <= thresholds.margin) {
    const secondEntry = findEntry(rules, second.item_id);
    if (
      secondEntry !== undefined &&
      outcomesDiffer(outcomeSet(topEntry, input.attributes), outcomeSet(secondEntry, input.attributes))
    ) {
      return abstain(input, "ambiguous_bins", topEntry, { candidate_ids: [topEntry.id, secondEntry.id] });
    }
  }

  return resolveEntry(input, topEntry);
}
