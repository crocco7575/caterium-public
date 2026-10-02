<p align="center">
  <img src="frontend/public/caterium-logo.png" alt="Caterium" width="220" />
</p>

<h1 align="center">Caterium</h1>

<p align="center">
  An Alpaca-based equities brokerage and Kalshi trading workspace.<br />
  Backtest ideas. Paper trade. Track orders, portfolios, and performance.
</p>

<p align="center">
  <a href="#run-it">Run the demo</a> ·
  <a href="#a-three-minute-tour">Take the tour</a> ·
  <a href="docs/ARCHITECTURE.md">Architecture</a> ·
  <a href="docs/TESTING.md">Tests</a> ·
  <a href="docs/DESIGN_DECISIONS.md">Design decisions</a>
</p>

---

**Caterium combines an Alpaca-based equities brokerage with Kalshi prediction-market research and trading tools.** It backtests strategy ideas, runs paper-trading experiments, tracks orders and fills, and monitors positions, P&L, strategy performance, and system health.

**This repository is the public engineering demo—not the full platform.** Try equities orders, YES/NO contracts, portfolio updates, and settlement using fictional data. The demo does not connect to Alpaca or Kalshi; production adapters, backtesting and research engines, private strategies, credentials, execution logic, and real results stay private.

![Running Caterium public dashboard with synthetic orders and balances](docs/assets/dashboard.png)

<sub>Captured from the running local demo after a mock fill and cancellation. All visible data is synthetic.</sub>

### Two workspaces

| Equities | Prediction markets |
| --- | --- |
| Brokerage-style BUY/SELL orders | Kalshi-style YES/NO contracts |
| Reserve cash or shares; fill or cancel | Reserve cash; fill or cancel |
| Track holdings and order events | Choose a fictional outcome and see settlement |
| $10,000 fictional starting balance | Separate $1,000 fictional starting balance |

These are independent demo balances, not connected accounts. The prediction-market example is deliberately simplified: fixed prices, buy-only contracts, no fees, and manual outcomes—not a replica of either provider's API or execution rules.

![Kalshi-style prediction-market demo with fictional contracts and settlement](docs/assets/prediction-markets.png)

<sub>The prediction workspace after a manually chosen outcome. All prices, balances, and P&L are synthetic.</sub>

## At a glance

| Layer | What you can inspect |
| --- | --- |
| **Interface** | Next.js / React / TypeScript dashboard; real API state, accessible forms, streamed events |
| **API** | FastAPI, Pydantic request validation, versioned routes, idempotent mutations |
| **Domain** | Equity orders, YES/NO contracts, cash and inventory reservations, mock fills, and atomic settlement |
| **Persistence** | SQLAlchemy 2, PostgreSQL, Alembic migrations, transactional domain events |
| **Verification** | pytest, isolated databases, Ruff, mypy, ESLint, TypeScript, CI jobs |
| **Development** | Docker Compose, locked dependencies, synthetic fixtures, no brokerage account required |

## Run it

With Docker Engine and Docker Compose running, from this directory:

```bash
docker compose up --build
```

Open **[localhost:3000](http://localhost:3000)**. Interactive API documentation is at **[localhost:8000/docs](http://localhost:8000/docs)**.

To obtain the source first:

```bash
git clone https://github.com/crocco7575/caterium-public.git
cd caterium-public
```

Compose starts PostgreSQL, applies the schema migrations, seeds two separate synthetic accounts, and starts the API and dashboard. The `.env.example` values are deliberately fake local defaults; no configuration or real credentials are required. Ports bind to loopback, and the database has no published port.

To stop while keeping your demo data:

```bash
docker compose down
```

Prefer not to run containers? See the [two-terminal setup](docs/DEVELOPMENT.md) using SQLite and Node.js. Compose's resource limits apply at runtime, not during image builds.

## A three-minute tour

1. **Submit** a BUY order for the fictional `DEMO` instrument. Cash is reserved, not spent.
2. **Fill** it through `MockBroker`. The order, cash, position, and events update together.
3. **Cancel** a second submitted order. Its reservation is released without changing holdings.
4. **Try a rejection** by selling inventory you do not own. The reason becomes part of the persisted record.
5. **Run ExampleStrategy**. It proposes one fixed demonstration order through the same validation path.
6. **Watch the event stream** in another tab. Reconnects replay committed events with monotonically increasing IDs.

Then switch to **Prediction markets**:

1. Buy 10 YES contracts for the fictional rocket launch at 40¢ each. The demo reserves $4.
2. Fill the order. Your cash decreases by $4 and you hold 10 contracts.
3. Submit another order without filling it, then simulate a YES outcome.
4. Settlement cancels the pending order, releases its reservation, and pays $10 for the winning holdings. The $6 gain is fictional arithmetic, not a trading result.
5. Refresh: the outcome and payout persist. Retrying settlement cannot pay twice.

Choose NO instead to see a losing YES position, or buy NO contracts to explore the other side. Settlement is final for that fictional market; a restart does not reset it. All displayed P&L is synthetic and manually determined—not evidence of an investment edge.

## Architecture

```mermaid
flowchart LR
    UI[Next.js dashboard] -->|same-origin REST| Proxy[Allowlisted API proxy]
    Proxy --> API[FastAPI /api/v1]
    API --> Service[Order and portfolio services]
    Example[ExampleStrategy interface] --> Service
    Service --> Broker["MockBroker<br/>fixed synthetic quotes"]
    API --> Prediction["YES/NO orders and settlement<br/>separate demo account"]
    Prediction -->|one transaction| DB
    Service -->|one transaction| DB[("PostgreSQL<br/>orders · cash · positions · events")]
    DB --> Stream[Bounded event reader]
    Stream -->|SSE + heartbeat| Proxy
    Proxy -->|live updates| UI
```

The backend owns both state machines. The frontend does not infer fills or recalculate authoritative balances. Equities events are streamed through SSE; prediction-market activity refreshes from persisted state after actions and periodically while visible.

### Engineering highlights

- **Retry-safe creation.** An idempotency key identifies a request. Identical retries reuse the order; a different payload under that key is rejected.
- **Funds are reserved before execution.** Submitting multiple orders cannot spend the same available balance. Sell submissions reserve inventory rather than permitting accidental shorting.
- **Atomic portfolio changes.** Fills update the order, cash, holdings, and events within one database transaction.
- **Explicit terminal states.** Fill and cancel operations have defined retry behavior. Invalid transitions do not silently mutate holdings.
- **Settlement without double payment.** Resolving a fictional market cancels its open orders, releases cash, records the result, and credits winning holdings in one transaction. Repeated outcomes cannot pay twice; conflicting outcomes fail.
- **Replaceable boundaries, one honest implementation.** Strategy and broker interfaces are present; only an intentionally trivial example and a mock provider ship.
- **Observable by construction.** Durable events drive the activity log and resumable SSE feed; heartbeat messages distinguish a quiet stream from a disconnected one.

Read [the architecture](docs/ARCHITECTURE.md) for transaction boundaries and [the decisions](docs/DESIGN_DECISIONS.md) for the compromises—including what SQLite tests do **not** prove about PostgreSQL concurrency.

## Testing is part of the design

Backend tests exercise the HTTP boundary, service behavior, persistence, and failure paths against isolated synthetic data. Frontend checks validate lint, types, and the production build. CI also uses an isolated PostgreSQL service.

See the [dated verification record](docs/VERIFICATION.md) for measured test results, browser checks, and limitations. PostgreSQL locking checks are separate from the fast SQLite suite.

```bash
cd backend
uv sync --frozen
uv run pytest -q
uv run pytest --cov=app --cov-report=term-missing
uv run ruff check .
uv run ruff format --check .
uv run mypy app
```

```bash
cd frontend
npm ci
npm run lint
npm run typecheck
npm test
npm run build
```

Run the project-owned publication checks from the repository root:

```bash
python3 tools/publication_check.py
docker compose config --quiet
```

[Testing guide →](docs/TESTING.md) · [Local verification record →](docs/VERIFICATION.md)

GitHub Actions is configured in [`.github/workflows/ci.yml`](.github/workflows/ci.yml). Check the [actual workflow results](https://github.com/crocco7575/caterium-public/actions) for the current commit; configuration alone does not establish that checks passed. There is no automatic deployment job.

## Repository map

```text
backend/
  app/              # API, typed schemas, domain services, persistence
  migrations/       # Fresh public-demo schema history
  tests/            # Isolated unit and integration checks
frontend/
  app/              # Dashboard and bounded same-origin API proxy
  components/       # Presentation and interaction
docs/               # Architecture, decisions, testing, publication notes
examples/
  synthetic_data/   # Explanation of the fictional fixture universe
tools/              # Public-source hygiene checks
.github/workflows/  # Backend, frontend, and publication CI
```

## What's intentionally missing

This is an engineering showcase, **not a research release or trading product**. It excludes:

- Proprietary strategies, signals, models, features, parameters, and allocation logic.
- Private execution behavior, live broker adapters, and exchange connectivity.
- Research notebooks, datasets, backtests, trade logs, and real performance figures.
- Credentials, personal or investor records, real accounts, and production infrastructure.
- The private repository's Git history.

The demo deliberately omits authentication, authorization, market realism, and production operations. **Do not expose it to the public internet or use it with real funds.** See [publication and security boundaries](docs/PUBLICATION.md).

## Disclaimer

This repository is an educational software-engineering demonstration. Synthetic examples are not financial advice, investment recommendations, or representations of actual trading performance. The demo does not connect to a brokerage or execute real trades.

No open-source license has been selected yet; public visibility alone would not grant reuse rights. Choose an appropriate license before publishing if you intend to permit reuse.
