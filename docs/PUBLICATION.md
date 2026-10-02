# Publication boundaries

## Clean-room scope

This repository is newly authored using generic engineering patterns. It has no private Git ancestry and no copied private datasets, source implementations, migration history, production configuration, reports, credentials, or personal records.

The original Caterium logo is included with the owner's explicit approval. Its pixels are unchanged; embedded text and EXIF metadata have been removed. No other private assets are included.

The public scope is a local synthetic equities and prediction-market demonstration. It cannot execute a real trade. The broader Caterium platform includes an equities brokerage layer built on Alpaca and prediction-market tools for Kalshi; neither provider's production integration is included here. The YES/NO example uses fictional markets, fixed prices, no fees, and user-selected outcomes. Proprietary implementations remain excluded.

## Review before sharing

- Read the README's claims, architecture scope, and disclaimer.
- Inspect `backend/app/` and `frontend/` for exactly what runs.
- Inspect `.env.example`, Compose, and Dockerfiles: all connection details must remain fictional/local.
- Inspect `docs/assets/`: visuals must show only newly generated synthetic demo state.
- Run `python3 tools/publication_check.py` and your preferred secret scanner.
- Review `git ls-files`, `git log --all --oneline`, and `git remote -v`.
- Confirm that ignored local databases, environment files, caches, and dependency trees are not staged.
- Choose a license deliberately if you intend to permit reuse. None is implied by public visibility.

Public sharing was explicitly approved after the local review. The public source lives at [caterium-public on GitHub](https://github.com/crocco7575/caterium-public); this does not expose a running application or any production service. The initial commit is fresh, with neutral demo-only author metadata rather than personal account details.

## Application security boundary

This is **not an internet-facing financial application**. It has two fixed synthetic accounts (equities and prediction markets) and no authentication, authorization, user/tenant isolation, TLS termination, production audit system, rate limiting service, or financial custody controls. The two balances are separate for demonstration purposes, not protected as distinct users' accounts. Local demo resources can be mutated by processes that can reach the backend. Do not add real funds or credentials.

Loopback host bindings and a constrained frontend proxy reduce accidental exposure; they do not make a hostile environment safe. Likewise, a passed secret scan cannot prove absence of intellectual property. Human review remains necessary.

## Ongoing hygiene

Keep real `.env` files, keys, databases, research, account records, trade logs, and infrastructure details outside this repository. CI runs source hygiene checks on every push and pull request, but these are a limited guardrail rather than a complete data-loss-prevention system.

Updating dependencies requires re-running tests and reviewing audit output. Lockfiles make a build repeatable; they do not certify that every dependency is free of vulnerabilities.
