FROM python:3.12-slim
WORKDIR /app
COPY pyproject.toml uv.lock README.md ./
RUN pip install --no-cache-dir uv && uv sync --frozen --no-dev --no-install-project
COPY app ./app
COPY alembic.ini .
COPY migrations ./migrations
RUN uv sync --frozen --no-dev
RUN useradd --create-home appuser && chown -R appuser:appuser /app
USER appuser
ENV PATH="/app/.venv/bin:$PATH"
ENV DATABASE_URL=sqlite:////tmp/caterium-demo.db
EXPOSE 8000
CMD ["sh", "-c", "python -m app.init_db && exec uvicorn app.main:app --host 0.0.0.0 --port 8000"]
