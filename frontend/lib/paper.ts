import { api } from "./api";

export type PaperStrategy = {
  id: "example-yes" | "example-no" | string;
  name: string;
  description: string;
};

export type PaperLedgerRow = {
  id: string;
  market: string;
  side: "YES" | "NO";
  entry_cents: number;
  result: "YES" | "NO";
  status: "FILLED" | "UNFILLED" | "SKIPPED";
  pnl_cents: number | null;
  reason: string;
};

export type PaperAlert = {
  id: string;
  subject: string;
  body: string;
  delivery: "preview_only";
};

export type PaperRun = {
  id: string;
  strategy_id: string;
  strategy_name: string;
  created_at: string;
  fixture_version: string;
  status: "COMPLETED";
  summary: {
    markets: number;
    signals: number;
    filled: number;
    unfilled: number;
    skipped: number;
    wins: number;
    losses: number;
    win_rate: number | null;
    pnl_cents: number;
    all_signal_pnl_cents: number;
    max_drawdown_cents: number;
  };
  equity: { index: number; pnl_cents: number }[];
  ledger: PaperLedgerRow[];
  alerts: PaperAlert[];
};

export type PaperDashboard = {
  demo: true;
  mode: "synthetic_fixture";
  delivery: "preview_only";
  strategies: PaperStrategy[];
  runs: PaperRun[];
};

export function getPaperDashboard() {
  return api<PaperDashboard>("paper/dashboard");
}

export function runPaperStrategy(strategyId: string, key: string) {
  return api<PaperRun>("paper/runs", {
    method: "POST",
    headers: { "Idempotency-Key": key, "content-type": "application/json" },
    body: JSON.stringify({ strategy_id: strategyId }),
  });
}
