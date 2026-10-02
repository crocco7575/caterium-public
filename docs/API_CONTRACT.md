# Demo API contract

All records are synthetic. No endpoint connects to Alpaca, Kalshi, or any real broker/exchange. JSON uses snake_case; money and prices are decimal strings, quantities are positive integers. The equities account starts with `10000.00` synthetic dollars. Supported fictional symbols are `DEMO` at `100.00` and `SAMPLE` at `25.00`; these are constants, not market data. Prediction markets use a separate `1000.00` synthetic-dollar account.

## Versioned endpoints

Base path: `/api/v1`. Frontend requests use the same path, proxied by the frontend server to the local backend.

- `GET /health`: `{status: "ok", demo: true, database: "ok"}`.
- `GET /dashboard`: `{demo: true, account, positions, orders, events, strategy}`.
- `GET /account`: the synthetic equities account.
- `GET /positions`: array of positions.
- `GET /orders`: newest-first array of orders (bounded to 100).
- `POST /orders`: requires `Idempotency-Key` header (1–128 characters); body `{symbol: "DEMO" | "SAMPLE", side: "BUY" | "SELL", quantity: integer}`. Returns an order with HTTP 201, or the same order on identical retry. A different payload with an existing key is HTTP 409.
- `POST /orders/{id}/fill`: fills the entire submitted order through MockBroker at its fixed synthetic price. Returns order. Repeating on a FILLED order is a harmless read; other terminal states return 409.
- `POST /orders/{id}/cancel`: cancels submitted order, releasing reservations. Repeating on CANCELLED is harmless; other terminal states return 409.
- `GET /events`: latest 50 persisted events, newest first.
- `GET /events/stream`: SSE `event: domain` with JSON event object and numeric `id`; honors `Last-Event-ID`. Initial cursor defaults to 0 (bounded batches). `event: heartbeat` is non-persisted and has no ID. Reconnect may redeliver, so consumers deduplicate IDs.
- `GET /strategies`: array containing the demo strategy descriptor.
- `POST /strategies/example/run`: requires `Idempotency-Key`; proposes one DEMO BUY contract through the same order service and returns the created order. This deliberately trivial constant action is not a trading signal.

## Objects

Account: `{id: "demo-account", cash: string, reserved_cash: string, available_cash: string, equity: string, currency: "USD"}`.

Position: `{symbol: string, quantity: integer, reserved_quantity: integer, average_price: string, market_price: string, market_value: string}`.

Order: `{id: string, symbol: string, side: "BUY" | "SELL", quantity: integer, price: string, status: "SUBMITTED" | "FILLED" | "CANCELLED" | "REJECTED", rejection_reason: string | null, created_at: ISO string, updated_at: ISO string}`.

Event: `{id: integer, type: string, order_id: string | null, message: string, created_at: ISO string}`. Service writes intermediate CREATED/VALIDATED transitions as events before SUBMITTED, in the same transaction. Business-rule rejection persists a REJECTED order and event; malformed requests return 422 without an order.

Strategy descriptor: `{id: "example", name: "ExampleStrategy", status: "DEMO_ONLY", description: string}`. Dashboard `strategy` is this object.

## Boundaries

Every mutation and its events commit atomically. BUY submissions reserve cash; SELL submissions reserve inventory. No margin, shorting, external feeds, fees, slippage, partial fills or real execution heuristics. The public demo intentionally demonstrates lifecycle mechanics, not economic realism.

Orders/events history endpoints are bounded to protect the local demo. SSE is a read-only projection of committed events; client refreshes the dashboard after domain events.

## Prediction-market endpoints

Base path: `/api/v1/prediction`. These are newly authored demo endpoints, not the Kalshi API. Only purchases of fictional YES/NO contracts are supported.

- `GET /dashboard`: `{demo: true, account, markets, orders, positions, events, realized_pnl}`. Orders are newest-first, bounded to 100; events are newest-first, bounded to 50. All holdings contribute to account totals, not just the bounded history.
- `GET /markets`: the two fictional market definitions and persisted settlement states.
- `POST /orders`: requires `Idempotency-Key` (1–128 characters); body `{market_id: string, outcome: "YES" | "NO", quantity: integer}`. The server chooses the fixed quote. Identical retries reuse the order; a changed payload with that key returns 409. Invalid/extra fields return 422, unknown markets return 404, and closed markets return 409. Insufficient available cash creates a REJECTED order with no reservation.
- `POST /orders/{id}/fill`: explicit full synthetic fill; releases reserved cash, debits cost, and adds holdings atomically. Matching retries do not create another fill.
- `POST /orders/{id}/cancel`: cancels a submitted order and releases its cash. Matching retries do not release cash twice.
- `POST /markets/{id}/settle`: body `{result: "YES" | "NO"}`. Cancels the market's pending orders, releases their reservations, credits winning holdings at `1.00` per contract, and marks the market settled in one transaction. Returns the market. Repeating the same result returns the existing result; a conflicting result returns 409. No reopen/reset endpoint exists.

### Prediction objects

Account has the same monetary fields as the equities account, with ID `prediction-demo-account`. Its cash and reservations are independent of equities.

Market: `{id, title, yes_price, no_price, status: "OPEN" | "SETTLED", result: "YES" | "NO" | null}`. IDs are `demo-launch` and `demo-rain`; quotes are fictional constants.

Order: `{id, market_id, outcome: "YES" | "NO", quantity, price, status, rejection_reason, created_at, updated_at}`. Status and timestamp conventions match the equity order format, but these records have a separate ledger.

Position: `{market_id, outcome, quantity, cost_basis, market_value, settled, payout}`. Quantity and cost basis remain inspectable after settlement. Settled market value is zero; payout is already included in cash, avoiding double-counted equity. `realized_pnl` is the sum of settled payouts minus settled cost bases, not a real trading result.

Event: `{id, type, order_id: string | null, market_id: string | null, message, created_at}`. Prediction event IDs are independent of equity event IDs; there is no combined SSE channel. The prediction UI refreshes its persisted dashboard after actions and periodically while visible.
