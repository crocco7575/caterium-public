"""Synthetic, buy-only prediction market accounting."""

import hashlib
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import UTC, datetime
from decimal import Decimal
from uuid import uuid4

from sqlalchemy import select, text
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.orm import Session

from app.models import (
    Account,
    PredictionEvent,
    PredictionFill,
    PredictionMarket,
    PredictionOrder,
    PredictionPosition,
)
from app.schemas import PredictionOrderIn

PREDICTION_ACCOUNT_ID = "prediction-demo-account"
ZERO = Decimal("0.00")
ONE = Decimal("1.00")
MARKETS = (
    ("demo-launch", "Will the demo rocket launch?", Decimal("0.40")),
    ("demo-rain", "Will it rain in the demo city?", Decimal("0.55")),
)


def now() -> datetime:
    return datetime.now(UTC)


def seed(db: Session) -> None:
    dialect = db.get_bind().dialect.name
    insert = sqlite_insert if dialect == "sqlite" else pg_insert
    db.execute(
        insert(Account)
        .values(
            id=PREDICTION_ACCOUNT_ID, cash=Decimal("1000.00"), reserved_cash=ZERO, currency="USD"
        )
        .on_conflict_do_nothing(index_elements=[Account.id])
    )
    for market_id, title, yes_price in MARKETS:
        db.execute(
            insert(PredictionMarket)
            .values(id=market_id, title=title, yes_price=yes_price, status="OPEN", result=None)
            .on_conflict_do_nothing(index_elements=[PredictionMarket.id])
        )
    db.commit()


@contextmanager
def locked_account(db: Session) -> Iterator[Account]:
    try:
        if db.get_bind().dialect.name == "sqlite" and not db.in_transaction():
            db.execute(text("BEGIN IMMEDIATE"))
        account = db.scalar(
            select(Account)
            .where(Account.id == PREDICTION_ACCOUNT_ID)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
        if account is None:
            raise RuntimeError("Initialize prediction demo account before serving requests")
        yield account
        db.commit()
    except Exception:
        db.rollback()
        raise


def event(db: Session, typ: str, order_id: str | None, market_id: str | None, message: str) -> None:
    db.add(
        PredictionEvent(
            type=typ, order_id=order_id, market_id=market_id, message=message, created_at=now()
        )
    )


def market(db: Session, market_id: str, lock: bool = False) -> PredictionMarket:
    query = select(PredictionMarket).where(PredictionMarket.id == market_id)
    if lock:
        query = query.with_for_update()
    found = db.scalar(query.execution_options(populate_existing=True))
    if found is None:
        raise KeyError(market_id)
    return found


def price(m: PredictionMarket, outcome: str) -> Decimal:
    return m.yes_price if outcome == "YES" else ONE - m.yes_price


def position(db: Session, market_id: str, outcome: str) -> PredictionPosition:
    found = db.get(PredictionPosition, (market_id, outcome), populate_existing=True)
    if found is None:
        found = PredictionPosition(
            market_id=market_id,
            outcome=outcome,
            quantity=0,
            cost_basis=ZERO,
            settled=False,
            payout=ZERO,
        )
        db.add(found)
        db.flush()
    return found


def submit(db: Session, payload: PredictionOrderIn, key: str) -> PredictionOrder:
    digest = hashlib.sha256(payload.model_dump_json().encode()).hexdigest()
    with locked_account(db) as account:
        existing = db.scalar(select(PredictionOrder).where(PredictionOrder.idempotency_key == key))
        if existing:
            if existing.payload_hash != digest:
                raise ValueError("idempotency key already used with different payload")
            return existing
        m = market(db, payload.market_id)
        if m.status != "OPEN":
            raise ValueError("market is settled")
        ts = now()
        order = PredictionOrder(
            id=str(uuid4()),
            idempotency_key=key,
            payload_hash=digest,
            market_id=m.id,
            outcome=payload.outcome,
            quantity=payload.quantity,
            price=price(m, payload.outcome),
            status="SUBMITTED",
            rejection_reason=None,
            created_at=ts,
            updated_at=ts,
        )
        db.add(order)
        db.flush()
        event(db, "CREATED", order.id, m.id, "Synthetic prediction order created")
        if account.cash - account.reserved_cash < order.price * order.quantity:
            order.status, order.rejection_reason = "REJECTED", "INSUFFICIENT_CASH"
        if order.status == "REJECTED":
            event(db, "REJECTED", order.id, m.id, order.rejection_reason or "Rejected")
        else:
            account.reserved_cash += order.price * order.quantity
            event(db, "SUBMITTED", order.id, m.id, "Funds reserved; awaiting synthetic fill")
    return order


def _terminal(db: Session, order_id: str, target: str) -> PredictionOrder:
    order = db.get(PredictionOrder, order_id, populate_existing=True)
    if order is None:
        raise KeyError(order_id)
    if order.status not in ("SUBMITTED", target):
        raise ValueError(f"cannot {target.lower()} an order in {order.status} state")
    return order


def fill(db: Session, order_id: str) -> PredictionOrder:
    with locked_account(db) as account:
        order = _terminal(db, order_id, "FILLED")
        if order.status == "FILLED":
            return order
        m = market(db, order.market_id, lock=True)
        if m.status != "OPEN":
            raise ValueError("market is settled")
        total = order.price * order.quantity
        p = position(db, order.market_id, order.outcome)
        account.cash -= total
        account.reserved_cash -= total
        p.cost_basis += total
        p.quantity += order.quantity
        order.status, order.updated_at = "FILLED", now()
        db.add(
            PredictionFill(
                order_id=order.id,
                quantity=order.quantity,
                price=order.price,
                created_at=order.updated_at,
            )
        )
        event(db, "FILLED", order.id, m.id, "Synthetic fill committed")
    return order


def cancel(db: Session, order_id: str) -> PredictionOrder:
    with locked_account(db) as account:
        order = _terminal(db, order_id, "CANCELLED")
        if order.status == "CANCELLED":
            return order
        account.reserved_cash -= order.price * order.quantity
        order.status, order.updated_at = "CANCELLED", now()
        event(db, "CANCELLED", order.id, order.market_id, "Order cancelled; reservation released")
    return order


def settle(db: Session, market_id: str, result: str) -> PredictionMarket:
    with locked_account(db) as account:
        m = market(db, market_id, lock=True)
        if m.status == "SETTLED":
            if m.result != result:
                raise ValueError("market already settled with a different result")
            return m
        for order in db.scalars(
            select(PredictionOrder).where(
                PredictionOrder.market_id == market_id, PredictionOrder.status == "SUBMITTED"
            )
        ).all():
            account.reserved_cash -= order.price * order.quantity
            order.status, order.updated_at = "CANCELLED", now()
            event(db, "CANCELLED", order.id, market_id, "Market settled; open order cancelled")
        for p in db.scalars(
            select(PredictionPosition).where(PredictionPosition.market_id == market_id)
        ).all():
            if not p.settled:
                p.payout = Decimal(p.quantity) if p.outcome == result else ZERO
                p.settled = True
                account.cash += p.payout
        m.status, m.result = "SETTLED", result
        event(db, "SETTLED", None, market_id, f"Market settled {result}")
    return m
