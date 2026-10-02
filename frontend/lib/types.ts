export type SymbolCode = "DEMO" | "SAMPLE";
export type Side = "BUY" | "SELL";
export type Account = {
  id: string;
  cash: string;
  reserved_cash: string;
  available_cash: string;
  equity: string;
  currency: string;
};
export type Position = {
  symbol: string;
  quantity: number;
  reserved_quantity: number;
  average_price: string;
  market_price: string;
  market_value: string;
};
export type Order = {
  id: string;
  symbol: SymbolCode;
  side: Side;
  quantity: number;
  price: string;
  status: string;
  rejection_reason: string | null;
  created_at: string;
  updated_at: string;
};
export type EventRecord = {
  id: number;
  type: string;
  order_id: string | null;
  message: string;
  created_at: string;
};
export type Strategy = {
  id: string;
  name: string;
  status: string;
  description: string;
};
export type DashboardData = {
  demo: boolean;
  account: Account;
  positions: Position[];
  orders: Order[];
  events: EventRecord[];
  strategy: Strategy;
};

export type PredictionMarket = {
  id: string;
  title: string;
  yes_price: string;
  no_price: string;
  status: "OPEN" | "SETTLED";
  result: "YES" | "NO" | null;
};
export type PredictionOrder = {
  id: string;
  market_id: string;
  outcome: "YES" | "NO";
  quantity: number;
  price: string;
  status: "SUBMITTED" | "FILLED" | "CANCELLED" | "REJECTED";
  rejection_reason: string | null;
  created_at: string;
  updated_at: string;
};
export type PredictionPosition = {
  market_id: string;
  outcome: "YES" | "NO";
  quantity: number;
  cost_basis: string;
  market_value: string;
  settled: boolean;
  payout: string;
};
export type PredictionEvent = {
  id: number;
  type: string;
  order_id: string | null;
  market_id: string | null;
  message: string;
  created_at: string;
};
export type PredictionDashboardData = {
  demo: boolean;
  account: Account;
  markets: PredictionMarket[];
  orders: PredictionOrder[];
  positions: PredictionPosition[];
  events: PredictionEvent[];
  realized_pnl: string;
};
