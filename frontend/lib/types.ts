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
