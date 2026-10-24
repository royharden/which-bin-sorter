// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TypedSearch } from "../src/ui/TypedSearch.tsx";
import { fixtureRules } from "./helpers/fixtureRules.ts";

afterEach(cleanup);
describe("typed local search", () => {
  it("requires selection and returns the table id without any vision dependency", () => {
    const onSelect = vi.fn();
    render(<TypedSearch rules={fixtureRules()} onSelect={onSelect} />);
    fireEvent.change(screen.getByLabelText("Item name"), { target: { value: "cardbord box" } });
    expect(onSelect).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Cardboard box" }));
    expect(onSelect).toHaveBeenCalledWith("cardboard_box");
    expect((screen.getByLabelText("Item name") as HTMLInputElement).value).toBe("");
  });
  it("shows candidates for a broad query, and an out-of-table state", () => {
    render(<TypedSearch rules={fixtureRules()} onSelect={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Item name"), { target: { value: "cup" } });
    expect(screen.getAllByRole("button").length).toBeGreaterThan(1);
    fireEvent.change(screen.getByLabelText("Item name"), { target: { value: "cell" } });
    expect(screen.getByRole("status").textContent).toContain("No matching item");
    expect(screen.queryByRole("button")).toBeNull();
  });
});
