"""Small, deterministic paper-testing fixture for the public showcase.

This module deliberately contains no market client, account mutation, SMTP, or
private strategy logic. It scores two transparent constant-side examples over
12 authored fictional markets.
"""

import hashlib
import json
from collections.abc import Iterable
from datetime import UTC, datetime
from typing import cast
from uuid import uuid4

from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models import PaperRun

FIXTURE_VERSION = "public-v1"
STRATEGIES = (
    {
        "id": "example-yes",
        "name": "Example Always YES",
        "description": "A transparent baseline that tests YES on every eligible fixture market.",
    },
    {
        "id": "example-no",
        "name": "Example Always NO",
        "description": "A transparent baseline that tests NO on every eligible fixture market.",
    },
)

# Market names and outcomes are authored public examples, not historical data.
MARKETS = (
    ("Demo market 01", "YES"),
    ("Demo market 02", "NO"),
    ("Demo market 03", "YES"),
    ("Demo market 04", "NO"),
    ("Demo market 05", "YES"),
    ("Demo market 06", "NO"),
    ("Demo market 07", "NO"),
    ("Demo market 08", "YES"),
    ("Demo market 09", "NO"),
    ("Demo market 10", "YES"),
    ("Demo market 11", "YES"),
    ("Demo market 12", "NO"),
)
SKIPPED = {2, 9}  # deterministic feature-unavailable examples (1-indexed)
UNFILLED = {4, 8}  # deterministic queue-unfilled examples (1-indexed)


def strategy_catalog() -> list[dict[str, str]]:
    return [dict(item) for item in STRATEGIES]


def _strategy(strategy_id: str) -> dict[str, str]:
    for item in STRATEGIES:
        if item["id"] == strategy_id:
            return dict(item)
    raise ValueError("unknown strategy_id")


def _build_run(strategy_id: str, created_at: datetime) -> dict[str, object]:
    strategy = _strategy(strategy_id)
    side = "YES" if strategy_id == "example-yes" else "NO"
    entry = 48 if side == "YES" else 52
    ledger: list[dict[str, object]] = []
    filled_pnl: list[int] = []
    assumed_pnl: list[int] = []
    for index, (market, result) in enumerate(MARKETS, start=1):
        if index in SKIPPED:
            status = "SKIPPED"
            pnl = None
            reason = "Fixture signal skipped: required example input unavailable"
        else:
            won = side == result
            pnl = 100 - entry if won else -entry
            assumed_pnl.append(pnl)
            if index in UNFILLED:
                status = "UNFILLED"
                reason = "Fixture signal not filled before the paper window closed"
            else:
                status = "FILLED"
                filled_pnl.append(pnl)
                reason = "Fixture paper fill"
        ledger.append(
            {
                "id": f"{strategy_id}-signal-{index:02d}",
                "market": market,
                "side": side,
                "entry_cents": entry,
                "result": result,
                "status": status,
                "pnl_cents": pnl if status == "FILLED" else None,
                "reason": reason,
            }
        )

    equity: list[dict[str, int]] = [{"index": 0, "pnl_cents": 0}]
    running = 0
    peak = 0
    max_drawdown = 0
    for index, pnl in enumerate(filled_pnl, start=1):
        running += pnl
        peak = max(peak, running)
        max_drawdown = max(max_drawdown, peak - running)
        equity.append({"index": index, "pnl_cents": running})
    wins = sum(pnl > 0 for pnl in filled_pnl)
    summary = {
        "markets": len(MARKETS),
        "signals": len(MARKETS) - len(SKIPPED),
        "filled": sum(row["status"] == "FILLED" for row in ledger),
        "unfilled": sum(row["status"] == "UNFILLED" for row in ledger),
        "skipped": sum(row["status"] == "SKIPPED" for row in ledger),
        "wins": wins,
        "losses": len(filled_pnl) - wins,
        "win_rate": round(wins / len(filled_pnl), 4) if filled_pnl else None,
        "pnl_cents": sum(filled_pnl),
        "all_signal_pnl_cents": sum(assumed_pnl),
        "max_drawdown_cents": max_drawdown,
    }
    alerts = [
        {
            "id": f"{strategy_id}-alert-{index:02d}",
            "subject": f"Caterium paper signal: {row['market']}",
            "body": (
                f"Preview only — {strategy['name']} produced a {row['side']} paper signal "
                f"at {row['entry_cents']} cents for {row['market']}. "
                "Requested size: 1 contract. PAPER ONLY — no real order was sent."
            ),
            "delivery": "preview_only",
        }
        for index, row in enumerate(ledger, start=1)
        if row["status"] != "SKIPPED"
    ]
    return {
        "id": str(uuid4()),
        "strategy_id": strategy_id,
        "strategy_name": strategy["name"],
        "created_at": created_at.isoformat().replace("+00:00", "Z"),
        "fixture_version": FIXTURE_VERSION,
        "status": "COMPLETED",
        "summary": summary,
        "equity": equity,
        "ledger": ledger,
        "alerts": alerts,
    }


def _lock_sqlite(db: Session) -> None:
    if db.get_bind().dialect.name == "sqlite" and not db.in_transaction():
        db.execute(text("BEGIN IMMEDIATE"))


def run(db: Session, strategy_id: str, idempotency_key: str) -> dict[str, object]:
    if len(idempotency_key) > 128 or not idempotency_key.strip():
        raise ValueError("Idempotency-Key is required and must be 1-128 characters")
    _strategy(strategy_id)
    digest = hashlib.sha256(strategy_id.encode()).hexdigest()
    _lock_sqlite(db)
    existing = db.scalar(select(PaperRun).where(PaperRun.idempotency_key == idempotency_key))
    if existing is not None:
        if existing.payload_hash != digest:
            db.rollback()
            raise ValueError("idempotency key already used with different payload")
        return cast(dict[str, object], json.loads(existing.payload))
    created_at = datetime.now(UTC)
    result = _build_run(strategy_id, created_at)
    db.add(
        PaperRun(
            id=str(result["id"]),
            idempotency_key=idempotency_key,
            payload_hash=digest,
            strategy_id=strategy_id,
            created_at=created_at,
            payload=json.dumps(result, separators=(",", ":")),
        )
    )
    try:
        db.commit()
    except IntegrityError as exc:
        # A concurrent PostgreSQL request may win the unique-key insert. Read
        # its complete result after rolling back the losing transaction.
        db.rollback()
        existing = db.scalar(select(PaperRun).where(PaperRun.idempotency_key == idempotency_key))
        if existing is None:
            raise exc from exc
        if existing.payload_hash != digest:
            raise ValueError("idempotency key already used with different payload") from None
        return cast(dict[str, object], json.loads(existing.payload))
    return result


def dashboard(db: Session) -> dict[str, object]:
    rows: Iterable[PaperRun] = db.scalars(
        select(PaperRun).order_by(PaperRun.created_at.desc()).limit(20)
    ).all()
    return {
        "demo": True,
        "mode": "synthetic_fixture",
        "delivery": "preview_only",
        "strategies": strategy_catalog(),
        "runs": [cast(dict[str, object], json.loads(row.payload)) for row in rows],
    }
