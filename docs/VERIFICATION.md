# Local verification record

Verified on **2026-10-02**. This records checks actually executed during the public demo build, not hosted CI results or production guarantees.

| Check | Observed result |
| --- | --- |
| Locked backend install | `uv sync --frozen` passed on Python 3.12 |
| Backend tests | **18 passed, 3 skipped** |
| Backend coverage | **95% statement coverage**, from `pytest --cov=app --cov-report=term-missing -q` |
| Ruff | Lint and format checks passed |
| mypy | Strict check passed for all 10 application source files; no route-module exemption |
| SQLite migrations | Upgrade, Alembic schema-drift check, downgrade, and bootstrap passed on a disposable database |
| Frontend tests | **8 passed**, including proxy origin, body-size, forwarding, failure and cancellation cases |
| Frontend static checks | ESLint and TypeScript passed |
| Frontend production build | Next.js standalone build passed; standalone server was started successfully |
| Native application | API and dashboard ran against a freshly migrated synthetic SQLite database |
| Browser flow | Submitted, filled, cancelled, ran ExampleStrategy, and observed an insufficient-inventory rejection |
| Backend outage | Stopped the demo API and confirmed the UI showed offline/stale-state messaging |
| Browser presentation | Meaningful content, no framework error overlay, no uncaught browser errors during the healthy flow; no horizontal overflow at 390px |
| Screenshot | Captured from the running synthetic demo, not a design mockup or production account |
| Compose configuration | `docker compose config --quiet` passed |
| Frontend dependency audit | `npm audit` reported zero known vulnerabilities after updating the test runner |
| Python dependency audit | `pip-audit` reported no known vulnerabilities in installed third-party packages after updating pytest; the editable local application was skipped |
| Publication checks | Project guard and manual source review found no unresolved publication items |
| Independent secret scanner | `detect-secrets` with 27 detectors, offline verification mode: no remaining findings after narrowly documenting the explicitly fake CI credentials |

## What was not verified

- **Docker images and the full Compose stack were not run.** The Docker daemon was unavailable; it was not started implicitly. Configuration validation and static Dockerfile review are not a successful container build.
- **Three PostgreSQL concurrency tests were skipped locally.** PostgreSQL was not available. They are configured in a separate disposable PostgreSQL CI job; a SQLite pass does not establish PostgreSQL correctness.
- **GitHub Actions has not run on GitHub.** No remote was configured and nothing was pushed. Workflow configuration is not a green CI result.
- The optional **Codex Security plugin scan did not complete**. It returned `Could not read local file: frontend/.next/server/app/api/v1/'[...path]'` while starting against generated build output. No completed plugin scan or security certification is claimed. The separately executed source-hygiene, dependency, manual, and secret checks above are distinct checks.
- The backend test client emitted an upstream deprecation warning about its HTTP testing transport. Tests passed; this is a tooling-maintenance item, not silently suppressed evidence.

## Scope of the publication audit

Reviewed newly authored application source, migrations, tests, dependency manifests/locks, container configuration, CI, documentation, and synthetic visuals. Checked for private-key material, credential patterns, personal filesystem paths, non-local infrastructure addresses, personal identifiers, unexpected file types, copied research/data, and private-history leakage.

Dependency/build caches, local demo databases, and generated coverage files are not publishable source and are ignored by Git. Dependency lockfiles are inspected by the project guard and dependency audit; high-entropy lock hashes are excluded from the independent secret scan to avoid misclassifying package integrity metadata. Scanner exceptions are limited to the visibly fake local CI connection fixture, not broad source directories.

These checks reduce publication risk; they cannot prove the absence of every secret or proprietary concept. Review the [publication checklist](PUBLICATION.md), select a license if appropriate, and run the Compose/PostgreSQL path before treating the container workflow as verified.
