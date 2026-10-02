# Engineering decisions and tradeoffs

## 1. A narrow runnable slice, not a redacted production dump

**Decision:** author a clean standalone application using generic structural patterns—typed API boundaries, dependency injection, persistence, lifecycle services, and streaming.

**Why:** a reviewer can run and understand it without needing private data or wondering whether hidden components are required. Exclusion also reduces accidental disclosure risk.

**Tradeoff:** this cannot demonstrate production scale or the proprietary research. Those are deliberately not claimed.

## 2. FastAPI and Pydantic at the boundary

**Decision:** validate request shapes before entering the service layer and publish a versioned API with generated interactive documentation.

**Why:** malformed inputs and business-rule rejections are different failures. Keeping them separate makes behavior testable and errors meaningful.

**Tradeoff:** schema validation alone does not enforce stateful invariants; funds, inventory, and transitions must be checked transactionally.

## 3. PostgreSQL at runtime; SQLite for a lightweight path

**Decision:** SQLAlchemy models and a fresh Alembic chain, with PostgreSQL in Compose and CI and a disposable SQLite test/local option.

**Why:** the same service interface supports fast isolated tests and a relational runtime with row locking.

**Tradeoff:** SQLite tests cannot certify PostgreSQL concurrency. The PostgreSQL CI lane is separate and necessary. Migrations and constraints need database-specific verification.

## 4. Explicit fill and cancel operations

**Decision:** submitted orders remain open until the user invokes a mock fill or cancellation.

**Why:** the reviewer can observe reservations and intermediate states rather than having every order instantly disappear into a success response.

**Tradeoff:** this is deliberately unrealistic execution. It models lifecycle/accounting behavior, not fill probability, price discovery, fees, or trading profitability.

## 5. Interfaces without speculative providers

**Decision:** provide a strategy abstraction and a mock brokerage boundary, with one trivial example strategy and one fixed-price broker.

**Why:** extension points should be visible without exposing research or inventing unused provider integrations.

**Tradeoff:** an interface is not evidence of a working production adapter. None is shipped or claimed.

## 6. Durable events and SSE instead of a message-bus stack

**Decision:** persist events atomically with order mutations and stream them in bounded reads.

**Why:** a one-way monitoring dashboard does not need bidirectional messaging or an extra broker service. The database stays authoritative.

**Tradeoff:** polling adds modest latency and database work; SSE clients need reconnection/deduplication. This is not a cross-service exactly-once protocol.

## 7. Local-only, synthetic-only

**Decision:** no external market data, no live credentials, no production addresses, no real performance figures, and loopback-only exposed ports.

**Why:** the public application is safe to explore without a financial account.

**Tradeoff:** authentication and authorization are intentionally absent. The application must not be internet-exposed or repurposed for real money without substantial additional engineering.

## 8. Separate prediction-market accounting

**Decision:** add an independent fictional YES/NO workspace rather than treating binary contracts as ordinary equity symbols. Keep fixed quotes, explicit full fills, and manual settlement; omit early sales and fees.

**Why:** a winning contract pays a fixed amount and disappears from open portfolio value. Recording outcome, cost basis, payout, pending-order cancellation, and cash together makes those semantics reviewable. Separate demo balances avoid implying a shared Alpaca/Kalshi funding or margin arrangement.

**Tradeoff:** this illustrates settlement accounting, not either provider's API, market mechanics, or profitability. Choosing an outcome makes the displayed gain/loss entirely synthetic. This example is now API-only; the Kalshi page centers on paper strategy testing.

## 9. A testing console, not a Kalshi order ticket

**Decision:** provide separate visual workspaces, each modeled on its private counterpart. The Kalshi page runs transparent constant-side strategies over a finite authored fixture and stores completed runs and alert previews.

**Why:** the interface should communicate the actual strategy-testing workflow: inspect decisions, include unfilled rows, keep assumed fills separate, and review notifications. A manual YES/NO purchase form communicated the wrong purpose.

**Tradeoff:** the fixture is not a real-market backtest, and its fill flags are not an execution model. Repeated runs are not additional evidence. Gmail is preview-only; production email delivery and private strategy rules are deliberately absent.

## Interview guide

Useful questions to explore in the source:

- Which state changes share a transaction, and what happens on rollback?
- How is duplicate submission different from duplicate execution?
- Why reserve resources when an order is submitted instead of when it fills?
- Where do API validation and business validation differ?
- What does a test with SQLite prove—and what does it not prove?
- How does settlement remain safe when a fill or another settlement races it?
- How would this change for multiple users, real brokers, partial fills, or fees?
- Which operational controls would be required before any production use?
