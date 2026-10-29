// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { emptyAttributes } from "../src/core/attributes.ts";
import { resolve } from "../src/core/resolve.ts";
import type { ResolveResult } from "../src/core/resolve.ts";
import { ResultCard } from "../src/ui/ResultCard.tsx";
import { fixtureRules, TEST_RULES_VERSION, TEST_THRESHOLDS } from "./helpers/fixtureRules.ts";

afterEach(cleanup);
function result(itemId: string) {
  return resolve({ mode: "selected", rules: fixtureRules(), rulesVersion: TEST_RULES_VERSION, thresholds: TEST_THRESHOLDS, item_id: itemId, attributes: emptyAttributes() });
}
function card(value: ResolveResult) {
  const callbacks = { onAnswer: vi.fn(), onChange: vi.fn(), onFeedback: vi.fn() };
  render(<ResultCard result={value} provenance="mock" fixture={true} {...callbacks} feedbackLabel={null} feedbackDisabled={false} />);
  return callbacks;
}
describe("rules result cards", () => {
  it.each(["cardboard_box", "paint_tin", "missing_item"])("includes the shared disclaimer and council link for %s", (id) => {
    card(result(id));
    expect(screen.getByText(/Local rules vary/)).toBeTruthy();
    const council = screen.getByRole("link", { name: /Check council guidance/ });
    expect(council.getAttribute("href")).toBe("https://fixture-city.example.invalid/");
    expect(council.getAttribute("rel")).toBe("noopener noreferrer");
    expect(screen.getByText(/Synthetic council link:/)).toBeTruthy();
    expect(screen.getByText(TEST_RULES_VERSION)).toBeTruthy();
  });
  it("renders resolver bin/prep plus complete source citation and fixture date", () => {
    const callbacks = card(result("cardboard_box"));
    expect(screen.getByRole("heading", { name: "Recycling (blue lid)" })).toBeTruthy();
    expect(screen.getByText("2026-10-24")).toBeTruthy();
    const citation = screen.getByRole("link", { name: /Synthetic rule source/ });
    expect(citation.getAttribute("href")).toContain("#cardboard_box");
    expect(citation.getAttribute("target")).toBe("_blank");
    expect(citation.getAttribute("rel")).toBe("noopener noreferrer");
    fireEvent.click(screen.getByRole("button", { name: "This is wrong" }));
    expect(callbacks.onFeedback).toHaveBeenCalledTimes(1);
  });
  it("offers all three clarification answers and Change item", () => {
    const callbacks = card(result("pizza_box"));
    expect(screen.getByRole("heading", { name: "Is the box greasy or has food stuck to it?" })).toBeTruthy();
    for (const label of ["Yes", "No", "Not sure"]) fireEvent.click(screen.getByRole("button", { name: label, exact: true }));
    expect(callbacks.onAnswer.mock.calls.map((call) => call[0])).toEqual(["yes", "no", "not_sure"]);
    fireEvent.click(screen.getByRole("button", { name: "Change item" }));
    expect(callbacks.onChange).toHaveBeenCalledTimes(1);
  });
});
