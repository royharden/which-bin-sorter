// In-memory fake of the LedgerDb seam (same interface as supabase/functions/identify/ledger.ts). It emulates the
// observable semantics of the RPCs in supabase/migrations/20261024000400_rpcs.sql: reserve (idempotency first, then
// rate window, then daily budget; a failing guard leaves no row), settle (reserved -> settled|error releases the
// reservation into spent; uncertain keeps it; never twice), record_feedback (digest idempotency, then rate window).
// It proves the handler's use of the statuses, NOT the SQL itself (DEFERRED-VALIDATION #4-#6).
import type {
  FeedbackArgs,
  FeedbackRecordStatus,
  LedgerDb,
  ReserveArgs,
  ReserveOutcome,
  SettleArgs,
  SettleStatus,
} from "../../supabase/functions/identify/handler.ts";

export interface FakeLedgerRow {
  request_id: string;
  request_digest: string;
  client_hash: string;
  model: string;
  upload_sha256: string;
  reserved_usd: number;
  status: "reserved" | SettleStatus;
  cost_usd: number | null;
  result: unknown;
  replay_count: number;
  error_code: string | null;
  day: string;
}

export interface FakeFeedbackRow {
  args: FeedbackArgs;
}

interface DayBudget {
  cap: number;
  reserved: number;
  spent: number;
}

export class FakeLedger implements LedgerDb {
  readonly rows = new Map<string, FakeLedgerRow>();
  readonly feedbackRows = new Map<string, FakeFeedbackRow>();
  readonly rateWindows = new Map<string, number>();
  readonly budgets = new Map<string, DayBudget>();
  readonly calls = { reserve: 0, settle: 0, recordFeedback: 0 };
  readonly reserveArgs: ReserveArgs[] = [];
  readonly feedbackArgs: FeedbackArgs[] = [];
  failReserve = false;
  failSettle = false;
  failFeedback = false;
  private readonly now: () => Date;

  constructor(now: () => Date) {
    this.now = now;
  }

  private day(): string {
    return this.now().toISOString().slice(0, 10);
  }

  /** Mirrors the SQL guard `count < limit` on the rate_window upsert. Returns false when the window is full. */
  private takeRate(key: string, op: string, limit: number, windowSeconds: number): boolean {
    const bucket = Math.floor(this.now().getTime() / 1000 / windowSeconds);
    const id = `${key}|${op}|${bucket}`;
    const count = this.rateWindows.get(id) ?? 0;
    if (count >= limit) return false;
    this.rateWindows.set(id, count + 1);
    return true;
  }

  async reserve(args: ReserveArgs): Promise<ReserveOutcome> {
    this.calls.reserve++;
    this.reserveArgs.push(args);
    if (this.failReserve) throw new Error("fake: connection refused");
    const existing = this.rows.get(args.request_id);
    if (existing !== undefined) {
      if (existing.request_digest !== args.request_digest) return { status: "conflict" };
      if (existing.status === "settled" && existing.result !== null) {
        existing.replay_count++;
        return { status: "replay", result: structuredClone(existing.result) };
      }
      return { status: "in_progress" };
    }
    // Guards are checked before the row is kept, so a failing guard leaves no row (the SQL rolls back its insert).
    const rateSnapshot = new Map(this.rateWindows);
    if (!this.takeRate(args.client_hash, args.op, args.rate_limit, args.window_seconds)) return { status: "rate_limited" };
    const day = this.day();
    const budget = this.budgets.get(day) ?? { cap: args.cap_usd, reserved: 0, spent: 0 };
    budget.cap = args.cap_usd;
    if (budget.reserved + budget.spent + args.worst_case_usd > budget.cap) {
      // Roll back the rate increment, exactly like the SQL sub-block.
      this.rateWindows.clear();
      for (const [key, value] of rateSnapshot) this.rateWindows.set(key, value);
      this.budgets.set(day, budget);
      return { status: "budget_exhausted" };
    }
    budget.reserved += args.worst_case_usd;
    this.budgets.set(day, budget);
    this.rows.set(args.request_id, {
      request_id: args.request_id,
      request_digest: args.request_digest,
      client_hash: args.client_hash,
      model: args.model,
      upload_sha256: args.upload_sha256,
      reserved_usd: args.worst_case_usd,
      status: "reserved",
      cost_usd: null,
      result: null,
      replay_count: 0,
      error_code: null,
      day,
    });
    return { status: "reserved" };
  }

  async settle(args: SettleArgs): Promise<void> {
    this.calls.settle++;
    if (this.failSettle) throw new Error("fake: settle timed out");
    const row = this.rows.get(args.request_id);
    if (row === undefined) throw new Error("fake: unknown request");
    if (row.status !== "reserved") throw new Error("fake: already settled");
    if (args.status !== "settled" && args.result !== null) throw new Error("fake: only a settled call stores a result");
    const budget = this.budgets.get(row.day);
    if (args.status === "uncertain") {
      row.cost_usd = null; // reservation kept
    } else {
      const charge = args.cost_usd ?? row.reserved_usd;
      row.cost_usd = charge;
      if (budget !== undefined) {
        budget.reserved = Math.max(budget.reserved - row.reserved_usd, 0);
        budget.spent += charge;
      }
    }
    row.status = args.status;
    row.error_code = args.error_code;
    row.result = args.result === null ? null : structuredClone(args.result);
  }

  async recordFeedback(args: FeedbackArgs): Promise<{ status: FeedbackRecordStatus }> {
    this.calls.recordFeedback++;
    this.feedbackArgs.push(args);
    if (this.failFeedback) throw new Error("fake: connection refused");
    const existing = this.feedbackRows.get(args.feedback_id);
    if (existing !== undefined) {
      return { status: existing.args.feedback_digest === args.feedback_digest ? "replay" : "conflict" };
    }
    if (!this.takeRate(args.rate_key, "feedback", args.rate_limit, args.window_seconds)) return { status: "rate_limited" };
    this.feedbackRows.set(args.feedback_id, { args: structuredClone(args) });
    return { status: "saved" };
  }

  budgetFor(day: string): DayBudget | undefined {
    return this.budgets.get(day);
  }
}
