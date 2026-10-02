# Local verification record

Verified on **2026-10-02**. This records checks actually executed during the public demo build, not production guarantees.

## Equities and prediction-market expansion

The updated application was rechecked locally with both workspaces enabled:

| Check | Observed result |
| --- | --- |
| Backend tests | **32 passed, 5 skipped**; **97% statement coverage** |
| Backend static checks | Ruff lint, formatting, and strict mypy passed |
| Prediction accounting | YES/NO payouts, cash reservations, fill/cancel retries, settlement rollback, closed-market rejection, stale-object refresh, and independent equity balance checked |
| Persistence | Upgrade preserved pre-existing equity data; downgrade/reupgrade and Alembic schema check passed on disposable SQLite databases; reseeding preserved settled state |
| Frontend | **16 tests passed**; ESLint, TypeScript, and production build passed |
| Browser retry | Deliberately lost the successful order response, then clicked retry: identical key and payload, one order, one cash reservation |
| Browser rejection | Simulated definitive HTTP 409 cleared the pending intent and unlocked the ticket; no fake success |
| Browser settlement | Bought/filled YES and NO positions, settled both fictional outcomes, observed winner/loser payouts and automatic cancellation of an open order |
| Browser isolation | Prediction settlement left the previously filled equity order and equity-account cash unchanged |
| Presentation | Original logo loaded; prediction payout history remained visible; no horizontal overflow at 390px |
| Compose | Configuration validation passed; no container engine started |

The five PostgreSQL-only checks were skipped locally. Their hosted results must be checked in the matching GitHub Actions run; SQLite does not prove PostgreSQL locking behavior. These checks use only isolated synthetic data, not the trading server or either provider's account. Browser screenshots are generated from the local demo. The broader platform description is not a claim that private Alpaca/Kalshi adapters or research engines ship in this repository.

## Initial equities-only verification

The following records the earlier baseline and its additional publication/dependency checks; counts here are historical, not the expanded suite's current counts.

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
- **The original local checks did not include GitHub Actions.** Publication was subsequently approved. Consult the [actual workflow runs](https://github.com/crocco7575/caterium-public/actions) for hosted results; workflow configuration alone is not a green CI result.
- The optional **Codex Security plugin scan did not complete**. It returned `Could not read local file: frontend/.next/server/app/api/v1/'[...path]'` while starting against generated build output. No completed plugin scan or security certification is claimed. The separately executed source-hygiene, dependency, manual, and secret checks above are distinct checks.
- The backend test client emitted an upstream deprecation warning about its HTTP testing transport. Tests passed; this is a tooling-maintenance item, not silently suppressed evidence.

## Scope of the publication audit

Reviewed newly authored application source, migrations, tests, dependency manifests/locks, container configuration, CI, documentation, and synthetic visuals. Checked for private-key material, credential patterns, personal filesystem paths, non-local infrastructure addresses, personal identifiers, unexpected file types, copied research/data, and private-history leakage.

Dependency/build caches, local demo databases, and generated coverage files are not publishable source and are ignored by Git. Dependency lockfiles are inspected by the project guard and dependency audit; high-entropy lock hashes are excluded from the independent secret scan to avoid misclassifying package integrity metadata. Scanner exceptions are limited to the visibly fake local CI connection fixture, not broad source directories.

These checks reduce publication risk; they cannot prove the absence of every secret or proprietary concept. Review the [publication checklist](PUBLICATION.md), select a license if appropriate, and run the Compose/PostgreSQL path before treating the container workflow as verified.
