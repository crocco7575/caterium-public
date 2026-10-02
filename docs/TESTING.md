# Testing

The tests focus on correctness at boundaries: HTTP input, transactional service behavior, persistent accounting, retries, and streaming—not on producing a large test count.

## Backend

```bash
cd backend
uv sync --frozen
uv run pytest -q
uv run pytest --cov=app --cov-report=term-missing
uv run ruff check .
uv run ruff format --check .
uv run mypy app
```

Tests create isolated synthetic accounts and instruments. FastAPI dependency overrides direct requests to a disposable test database; they do not use the developer's demo database. Unit checks target strategy/broker contracts and formatting; API/service integration checks verify records, transitions, resources, events, and errors together.

Important invariants include:

- Submitted BUY orders reserve cash and cannot overcommit available funds.
- Submitted SELL orders reserve quantity and cannot create short positions.
- Fills atomically update order, cash, positions, and events.
- Cancellations release reservations without manufacturing holdings.
- Duplicate requests do not duplicate orders; conflicting idempotency payloads fail.
- Terminal states cannot be crossed through an incompatible operation.
- Malformed input is distinguishable from a persisted business-rule rejection.
- Events preserve cursor order and SSE framing without retaining a database session while waiting.

### SQLite versus PostgreSQL

SQLite is the default isolated test database. It provides fast tests for domain behavior but is not a substitute for PostgreSQL locking semantics. CI runs a separate PostgreSQL-backed test lane against a throwaway database. Never point a test process at a database containing data you want to keep; test setup/teardown may rebuild its schema.

### Migrations

The new public schema has its own migration history. Test both upgrade and downgrade on a **disposable demo database**, and initialize it before starting the API. The private schema history is not present.

## Frontend

```bash
cd frontend
npm ci
npm run lint
npm run typecheck
npm test
npm run build
```

A successful build is not a browser test. The verification record separately reports the actual local browser flow and any limits. For a manual check, submit → fill → inspect the position, submit → cancel → inspect released funds, and try an unsupported sale. Open a second tab to observe event-driven refresh. Stop the backend to check that the UI does not pretend stale data is a healthy connection.

## Publication hygiene

```bash
python3 tools/publication_check.py
docker compose config --quiet
```

The project-owned checker detects a limited set of unsafe paths/content and unexpected publishable file types. It is not a guarantee that source is free of proprietary material or secrets. Combine it with manual review, an independent secret scanner, dependency checks, and inspection of the actual staged tree.

See [VERIFICATION.md](VERIFICATION.md) for what was actually run, rather than treating CI configuration as evidence of a hosted CI result.
