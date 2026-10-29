// Rules mirror for feedback validation (PLAN.md 4.7, R1-1). Server-only. The function folder imports nothing outside
// itself, so this hand-authored const mirrors rules/fixture-city.json (bin ids, entry ids, rule ids with the bin each
// rule answers with) and the seven reason codes of src/core/reasons.ts. tests/ruleCatalog.test.ts asserts parity.
// Feedback is an untrusted user report checked against these lists; it never edits the rules.

/** `bins[].id` of the rules file. */
export const BIN_IDS: readonly string[] = ["recycling", "food_and_garden", "garbage", "drop_off", "hazardous_drop_off"];

/** `entries[].id` of the rules file, in file order. */
export const ENTRY_IDS: readonly string[] = [
  "pizza_box",
  "cardboard_box",
  "plastic_film",
  "black_plastic_tray",
  "lined_paper_cup",
  "unlined_paper_cup",
  "paper_plate",
  "aerosol_can",
  "small_electrical_device",
  "mobile_phone",
  "loose_battery",
  "glass_jar",
  "clear_glass_bottle",
  "clear_plastic_bottle",
  "drinking_glass",
  "compostable_plastic_cup",
  "paint_tin",
  "gas_cylinder",
  "aluminium_can",
  "steel_food_tin",
  "newspaper",
  "junk_mail",
  "egg_carton",
  "beverage_carton",
  "yogurt_pot",
  "polystyrene_foam",
  "food_scraps",
  "garden_waste",
  "tea_bag",
  "disposable_nappy",
  "clothing_textiles",
  "fluorescent_tube",
  "aluminium_foil",
  "crisp_packet",
];

/**
 * Every rule id (`<entry>` for an unconditional entry, `<entry>#<condition index>` for a condition) and the bin it
 * answers with; null for an ask_council entry or an instruction-only condition (no bin).
 */
export const RULE_BINS: Readonly<Record<string, string | null>> = {
  "pizza_box#0": "food_and_garden",
  "pizza_box#1": "recycling",
  cardboard_box: "recycling",
  plastic_film: "drop_off",
  black_plastic_tray: "garbage",
  lined_paper_cup: "garbage",
  unlined_paper_cup: "food_and_garden",
  "paper_plate#0": "food_and_garden",
  "paper_plate#1": "recycling",
  "aerosol_can#0": "recycling",
  "aerosol_can#1": "hazardous_drop_off",
  "small_electrical_device#0": "hazardous_drop_off",
  "small_electrical_device#1": "drop_off",
  mobile_phone: "drop_off",
  loose_battery: "hazardous_drop_off",
  "glass_jar#0": "garbage",
  "glass_jar#1": "recycling",
  "glass_jar#2": "recycling",
  clear_glass_bottle: "drop_off",
  clear_plastic_bottle: "recycling",
  "drinking_glass#0": "garbage",
  "drinking_glass#1": "drop_off",
  "compostable_plastic_cup#0": "food_and_garden",
  "compostable_plastic_cup#1": "garbage",
  paint_tin: null,
  "gas_cylinder#0": null,
  "gas_cylinder#1": "drop_off",
  aluminium_can: "recycling",
  steel_food_tin: "recycling",
  newspaper: "recycling",
  junk_mail: "recycling",
  egg_carton: "food_and_garden",
  beverage_carton: "recycling",
  yogurt_pot: "recycling",
  polystyrene_foam: "garbage",
  food_scraps: "food_and_garden",
  garden_waste: "food_and_garden",
  tea_bag: "food_and_garden",
  disposable_nappy: "garbage",
  clothing_textiles: "drop_off",
  fluorescent_tube: "hazardous_drop_off",
  "aluminium_foil#0": "garbage",
  "aluminium_foil#1": "recycling",
  crisp_packet: "garbage",
};

/** The seven abstention reason codes, exactly (mirror of src/core/reasons.ts REASON_CODES, same order). */
export const REASON_CODES: readonly string[] = [
  "no_candidate",
  "low_confidence",
  "ambiguous_bins",
  "multiple_items",
  "poor_image",
  "ask_council_rule",
  "unknown_condition",
];

export function isKnownEntry(id: unknown): id is string {
  return typeof id === "string" && ENTRY_IDS.includes(id);
}

export function isKnownBin(id: unknown): id is string {
  return typeof id === "string" && BIN_IDS.includes(id);
}

export function isKnownReason(code: unknown): code is string {
  return typeof code === "string" && REASON_CODES.includes(code);
}

export function isKnownRule(ruleId: unknown): ruleId is string {
  return typeof ruleId === "string" && Object.prototype.hasOwnProperty.call(RULE_BINS, ruleId);
}

/** True when `ruleId` is a rule of `entryId` (`entry` itself or `entry#<n>`). */
export function ruleBelongsTo(ruleId: string, entryId: string): boolean {
  return ruleId === entryId || (ruleId.startsWith(`${entryId}#`) && /^\d+$/.test(ruleId.slice(entryId.length + 1)));
}
