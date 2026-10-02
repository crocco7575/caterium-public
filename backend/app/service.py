"""Single-account demo accounting. Each mutation owns its transaction."""

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

from app.broker import Broker, MockBroker
from app.models import Account, Event, Fill, Order, Position
from app.schemas import OrderIn

ACCOUNT_ID = "demo-account"
ZERO = Decimal("0.00")
broker: Broker = MockBroker()


def now() -> datetime:
    return datetime.now(UTC)


def add_event(db: Session, typ: str, order_id: str | None, message: str) -> None:
    db.add(Event(type=typ, order_id=order_id, message=message, created_at=now()))


def seed(db: Session) -> None:
    """Idempotent synthetic bootstrap; a restart must never reset balances."""
    dialect = db.get_bind().dialect.name
    insert = sqlite_insert if dialect == "sqlite" else pg_insert
    statement = insert(Account).values(
        id=ACCOUNT_ID, cash=Decimal("10000.00"), reserved_cash=ZERO, currency="USD"
    )
    db.execute(statement.on_conflict_do_nothing(index_elements=[Account.id]))
    db.commit()


@contextmanager
def locked_account(db: Session) -> Iterator[Account]:
    """Lock before reading orders, so retries cannot reuse a stale order state.

    PostgreSQL locks the one demo account. SQLite serializes writers with an
    immediate transaction; this is a convenience, not equivalent row locking.
    All callers use a dedicated request session. On failure, no event or partial
    accounting change can escape the rollback.
    """
    try:
        if db.get_bind().dialect.name == "sqlite" and not db.in_transaction():
            db.execute(text("BEGIN IMMEDIATE"))
        account = db.scalar(
            select(Account)
            .where(Account.id == ACCOUNT_ID)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
        if account is None:
            raise RuntimeError("Initialize the synthetic account before serving requests")
        yield account
        db.commit()
    except Exception:
        db.rollback()
        raise


def position_for(db: Session, symbol: str) -> Position:
    position = db.get(Position, symbol, populate_existing=True)
    if position is None:
        position = Position(symbol=symbol, quantity=0, reserved_quantity=0, average_price=ZERO)
        db.add(position)
        db.flush()
    return position


def submit(db: Session, payload: OrderIn, key: str) -> Order:
    digest = hashlib.sha256(payload.model_dump_json().encode()).hexdigest()
    with locked_account(db) as account:
        existing = db.scalar(select(Order).where(Order.idempotency_key == key))
        if existing is not None:
            if existing.payload_hash != digest:
                raise ValueError("idempotency key already used with different payload")
            return existing
        timestamp = now()
        order = Order(
            id=str(uuid4()),
            idempotency_key=key,
            payload_hash=digest,
            symbol=payload.symbol,
            side=payload.side,
            quantity=payload.quantity,
            price=broker.quote(payload.symbol),
            status="SUBMITTED",
            rejection_reason=None,
            created_at=timestamp,
            updated_at=timestamp,
        )
        db.add(order)
        db.flush()
        add_event(db, "CREATED", order.id, "Synthetic order created")
        position = position_for(db, payload.symbol)
        notional = order.price * order.quantity
        if order.side == "BUY" and account.cash - account.reserved_cash < notional:
            order.rejection_reason = "INSUFFICIENT_CASH"
        elif (
            order.side == "SELL" and position.quantity - position.reserved_quantity < order.quantity
        ):
            order.rejection_reason = "INSUFFICIENT_POSITION"
        if order.rejection_reason:
            order.status = "REJECTED"
            add_event(db, "REJECTED", order.id, order.rejection_reason)
        else:
            add_event(db, "VALIDATED", order.id, "Funds or inventory validated")
            if order.side == "BUY":
                account.reserved_cash += notional
            else:
                position.reserved_quantity += order.quantity
            add_event(db, "SUBMITTED", order.id, "Resources reserved; awaiting mock fill")
    return order


def submitted_order(db: Session, order_id: str, target: str) -> Order:
    order = db.get(Order, order_id, populate_existing=True)
    if order is None:
        raise KeyError(order_id)
    if order.status not in ("SUBMITTED", target):
        raise ValueError(f"cannot {target.lower()} an order in {order.status} state")
    return order


def fill(db: Session, order_id: str) -> Order:
    with locked_account(db) as account:
        order = submitted_order(db, order_id, "FILLED")
        if order.status == "FILLED":
            return order
        execution = broker.fill(order.symbol, order.quantity)
        if execution.price != order.price or execution.quantity != order.quantity:
            raise ValueError("MockBroker must return the reserved fixed price and full quantity")
        position = position_for(db, order.symbol)
        total = execution.price * execution.quantity
        if order.side == "BUY":
            account.cash -= total
            account.reserved_cash -= total
            new_quantity = position.quantity + order.quantity
            position.average_price = (
                (position.average_price * position.quantity + total) / new_quantity
            ).quantize(Decimal("0.01"))
            position.quantity = new_quantity
        else:
            account.cash += total
            position.quantity -= order.quantity
            position.reserved_quantity -= order.quantity
            if position.quantity == 0:
                position.average_price = ZERO
        order.status, order.updated_at = "FILLED", now()
        db.add(
            Fill(
                order_id=order.id,
                quantity=execution.quantity,
                price=execution.price,
                created_at=order.updated_at,
            )
        )
        add_event(db, "FILLED", order.id, "Mock fill committed with cash and inventory")
    return order


def cancel(db: Session, order_id: str) -> Order:
    with locked_account(db) as account:
        order = submitted_order(db, order_id, "CANCELLED")
        if order.status == "CANCELLED":
            return order
        if order.side == "BUY":
            account.reserved_cash -= order.price * order.quantity
        else:
            position_for(db, order.symbol).reserved_quantity -= order.quantity
        order.status, order.updated_at = "CANCELLED", now()
        add_event(db, "CANCELLED", order.id, "Order cancelled; reservation released")
    return order
