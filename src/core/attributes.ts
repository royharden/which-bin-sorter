// Resolved attribute state (PLAN.md 4.4): what is known about the item's condition and who said so.
import { ATTRIBUTE_ORDER } from "./rules.ts";
import type { Attr } from "./rules.ts";

/**
 * `vision`: reported by the vision step (null = the model could not tell).
 * `user`: answered through a clarify button (null = the user tapped "Not sure"; the attribute is exhausted).
 * `none`: nothing known yet (selected mode: typed path or Change item).
 */
export type AttrSource = "vision" | "user" | "none";

export interface AttrState {
  readonly value: boolean | null;
  readonly source: AttrSource;
}

export type ResolvedAttributes = Readonly<Record<Attr, AttrState>>;

/** The attribute part of a validated vision output (`true | false | null` each; missing is treated as null). */
export type VisionAttributeValues = Partial<Record<Attr, boolean | null>>;

export type ClarifyAnswer = "yes" | "no" | "not_sure";

export const CLARIFY_OPTIONS: readonly ClarifyAnswer[] = ["yes", "no", "not_sure"];

function build(make: (attr: Attr) => AttrState): ResolvedAttributes {
  const out = {} as Record<Attr, AttrState>;
  for (const attr of ATTRIBUTE_ORDER) out[attr] = make(attr);
  return out;
}

/** Selected mode start state: all six attributes unknown. */
export function emptyAttributes(): ResolvedAttributes {
  return build(() => ({ value: null, source: "none" }));
}

/**
 * Change item: switches to selected mode and clears every attribute, user answers and vision values alike
 * (PLAN.md 4.4, R1-2d). Kept as its own name so callers say what they mean.
 */
export function changeItemAttributes(): ResolvedAttributes {
  return emptyAttributes();
}

/** Vision mode start state, from the vision output's attributes. Anything other than a boolean becomes null. */
export function fromVision(values: VisionAttributeValues): ResolvedAttributes {
  return build((attr) => {
    const value = values[attr];
    return { value: typeof value === "boolean" ? value : null, source: "vision" };
  });
}

/** "Not sure" was answered for this attribute: it can never be asked again for this item. */
export function isExhausted(state: AttrState): boolean {
  return state.source === "user" && state.value === null;
}

export function hasUserAnswer(state: AttrState): boolean {
  return state.source === "user";
}

/**
 * Applies one clarify answer. At most one clarify per attribute per item: answering an attribute the user
 * already answered throws.
 */
export function applyClarifyAnswer(
  attributes: ResolvedAttributes,
  attr: Attr,
  answer: ClarifyAnswer,
): ResolvedAttributes {
  if (hasUserAnswer(attributes[attr])) {
    throw new Error(`attribute "${attr}" was already answered for this item`);
  }
  const value = answer === "yes" ? true : answer === "no" ? false : null;
  const next: Record<Attr, AttrState> = { ...attributes };
  next[attr] = { value, source: "user" };
  return next;
}
