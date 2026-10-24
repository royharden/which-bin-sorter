import { appendFileSync, closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";

export interface Reservation { type: "reserve"; call_id: string; run_id: string; worst_usd: number; at: string }
export interface Settlement { type: "settle"; call_id: string; status: "settled" | "uncertain"; cost_usd: number | null; at: string }
export type LedgerEvent = Reservation | Settlement;
export class BudgetStop extends Error {}
const positive = (n: number): boolean => Number.isFinite(n) && n > 0;
export function committedSpend(events: readonly LedgerEvent[]): number {
  const reserved = new Map<string, Reservation>();
  const settled = new Map<string, Settlement>();
  for (const event of events) {
    if (event.type === "reserve") {
      if (!positive(event.worst_usd) || reserved.has(event.call_id)) throw new Error("invalid/duplicate budget reservation");
      reserved.set(event.call_id, event);
    } else {
      const claim = reserved.get(event.call_id);
      if (claim === undefined || settled.has(event.call_id) || (event.status !== "settled" && event.status !== "uncertain")) throw new Error("invalid budget settlement");
      if (event.status === "settled" && (event.cost_usd === null || !Number.isFinite(event.cost_usd) || event.cost_usd < 0)) throw new Error("invalid actual cost");
      settled.set(event.call_id, event);
    }
  }
  let total = 0;
  for (const [id, claim] of reserved) {
    const final = settled.get(id);
    total += final?.status === "settled" ? final.cost_usd! : claim.worst_usd;
  }
  return total;
}
export function preflight(events: readonly LedgerEvent[], plannedBounds: readonly number[], capUsd: number): void {
  if (!positive(capUsd) || plannedBounds.some((n) => !positive(n))) throw new Error("positive explicit budget and verified bounds required");
  if (committedSpend(events) + plannedBounds.reduce((s, n) => s + n, 0) > capUsd + 1e-12) throw new BudgetStop("preflight exceeds EVAL_BUDGET_USD");
}
function readLedger(file: string): LedgerEvent[] {
  return existsSync(file) ? readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line) as LedgerEvent) : [];
}
export interface BudgetSession { reserve(worstUsd: number): string; settle(id: string, actual: number | null): void; close(): void }
/** Exclusive process lock spans preflight, every dispatch and settlement. Crash leaves lock + full reservation.
 * Close archives the lock (no deletion). An abandoned lock requires explicit operator reconciliation. */
export function openBudgetSession(ledgerFile: string, lockFile: string, runId: string, bounds: readonly number[], capUsd: number): BudgetSession {
  mkdirSync(dirname(lockFile), { recursive: true });
  const lock = openSync(lockFile, "wx");
  writeFileSync(lock, JSON.stringify({ run_id: runId, at: new Date().toISOString() }) + "\n");
  fsyncSync(lock);
  closeSync(lock);
  const release = (): void => renameSync(lockFile, `${lockFile}.released-${randomUUID()}`);
  let events: LedgerEvent[];
  try { events = readLedger(ledgerFile); preflight(events, bounds, capUsd); } catch (error) { release(); throw error; }
  let closed = false;
  const append = (event: LedgerEvent): void => {
    if (closed) throw new Error("budget session closed");
    // appendFileSync followed by fsync makes reservations durable before transport dispatch.
    const fd = openSync(ledgerFile, "a");
    try { appendFileSync(fd, JSON.stringify(event) + "\n"); fsyncSync(fd); } finally { closeSync(fd); }
    events.push(event);
  };
  return {
    reserve(worstUsd) {
      preflight(events, [worstUsd], capUsd);
      const id = randomUUID();
      append({ type: "reserve", call_id: id, run_id: runId, worst_usd: worstUsd, at: new Date().toISOString() });
      return id;
    },
    settle(id, actual) {
      const event: Settlement = { type: "settle", call_id: id, status: actual === null ? "uncertain" : "settled", cost_usd: actual, at: new Date().toISOString() };
      committedSpend([...events, event]);
      append(event);
      const claim = events.find((e): e is Reservation => e.type === "reserve" && e.call_id === id);
      if (actual !== null && claim !== undefined && actual > claim.worst_usd) throw new BudgetStop("actual exceeded verified reservation bound; spent cost recorded, run stopped");
    },
    close() { if (!closed) { release(); closed = true; } },
  };
}
export function lockHeldout(file: string, confirmed: boolean, metadata: { run_id: string; manifest_digest: string; methods_digest: string; config_digest: string }): void {
  if (!confirmed) throw new Error("heldout requires --confirm-heldout-once");
  mkdirSync(dirname(file), { recursive: true });
  const fd = openSync(file, "wx");
  try { writeFileSync(fd, JSON.stringify({ ...metadata, date: new Date().toISOString() }) + "\n"); fsyncSync(fd); } finally { closeSync(fd); }
}
