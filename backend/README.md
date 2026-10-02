# Caterium public demo backend

This is a synthetic, local-only lifecycle demo. It has no broker, market feed,
credentials, or research/execution logic. Run `uv sync --frozen`, then
`uv run uvicorn app.main:app --reload` from this directory.

`DATABASE_URL` defaults to a local SQLite file. PostgreSQL is supported with a
`postgresql+psycopg://...` URL. Use `uv run python -m app.init_db` to apply the
migration and seed the synthetic account.
