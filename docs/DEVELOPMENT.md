# Local development

## Container path

Requirements: Docker Engine and Docker Compose. From the repository root:

```bash
docker compose config --quiet
docker compose up --build
```

Dashboard: http://localhost:3000. API docs: http://localhost:8000/docs.

No real credentials are needed. `.env.example` only documents fake demo defaults. The PostgreSQL volume persists across restarts. `docker compose down` stops the demo without deleting that volume. Do not use a production database or add live credentials.

## Native path: two terminals

Requirements: Python 3.12 or later, [uv](https://docs.astral.sh/uv/), Node.js 24, and npm. No PostgreSQL installation is required for this path.

**Terminal 1 — backend:**

```bash
cd backend
uv sync --frozen
uv run python -m app.init_db
uv run uvicorn app.main:app --host 127.0.0.1 --port 8000
```

The default SQLite demo file is local and ignored by Git. Initialization runs Alembic and creates the fictional account idempotently. It does not import anything.

**Terminal 2 — frontend:**

```bash
cd frontend
npm ci
npm run dev -- --hostname 127.0.0.1
```

The server-side proxy defaults to the local API. To use another **local demo** backend port, set `API_BASE_URL` in the frontend process environment. Never use it to point this demo at production.

## Production frontend build (still local demo)

```bash
cd frontend
npm ci
npm run build
npm run start -- --hostname 127.0.0.1
```

The Docker image uses Next.js standalone output instead. Both variants use the same public source. Neither makes the application production-ready from a security perspective.

## Resource budget

Compose caps each running service's memory and CPU. These are local guardrails, not measured capacity claims. Image builds, package installs, and the frontend compiler are outside those caps. Build serially on a constrained machine. Native mode lets you avoid running a container engine altogether.
