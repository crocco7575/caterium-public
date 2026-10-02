# Demo API contract

All records are synthetic. No endpoint connects to a real broker. JSON uses snake_case; money and prices are decimal strings, quantities are positive integers. The demo account starts with `10000.00` synthetic dollars. Supported fictional symbols are `DEMO` at `100.00` and `SAMPLE` at `25.00`; these are constants, not market data.

## Versioned endpoints

Base path: `/api/v1`. Frontend requests use the same path, proxied by the frontend server to the local backend.

- `GET /health`: `{status: "ok", demo: true, database: "ok"}`.
- `GET /dashboard`: `{demo: true, account, positions, orders, events, strategy}`.
- `GET /account`: the single synthetic account.
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
