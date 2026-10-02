from decimal import Decimal

import pytest
from sqlalchemy import select

from app import service
from app.broker import MockExecution
from app.models import Account, Event, Fill, Order, Position
from app.schemas import OrderIn


def order(db, key: str, side: str = "BUY", quantity: int = 1):
    return service.submit(db, OrderIn(symbol="DEMO", side=side, quantity=quantity), key)


def test_multiple_reservations_block_second_overspend(db):
    first = order(db, "first", quantity=99)
    second = order(db, "second", quantity=2)
    assert first.status == "SUBMITTED"
    assert second.status == "REJECTED"
    account = db.get(Account, service.ACCOUNT_ID)
    assert account and account.reserved_cash == Decimal("9900.00")


def test_sell_fill_credits_cash_and_zeroes_basis(db):
    buy = order(db, "basis-buy", quantity=2)
    service.fill(db, buy.id)
    sell = order(db, "basis-sell", side="SELL", quantity=1)
    service.fill(db, sell.id)
    account = db.get(Account, service.ACCOUNT_ID)
    position = db.get(Position, "DEMO")
    assert account and account.cash == Decimal("9900.00")
    assert position and position.quantity == 1 and position.average_price == Decimal("100.00")

    final_sell = order(db, "basis-final", side="SELL", quantity=1)
    service.fill(db, final_sell.id)
    position = db.get(Position, "DEMO")
    assert position and position.quantity == 0 and position.average_price == Decimal("0.00")


def test_cancelled_sell_releases_inventory(db):
    buy = order(db, "inventory-buy", quantity=1)
    service.fill(db, buy.id)
    sell = order(db, "inventory-sell", side="SELL", quantity=1)
    service.cancel(db, sell.id)
    position = db.get(Position, "DEMO")
    assert position and position.quantity == 1 and position.reserved_quantity == 0


def test_fill_failure_rolls_back_account_order_and_events(db, monkeypatch: pytest.MonkeyPatch):
    submitted = order(db, "broker-failure", quantity=1)
    before_events = len(db.scalars(select(Event)).all())

    class BrokenBroker:
        def quote(self, symbol: str) -> Decimal:
            return Decimal("100.00")

        def fill(self, symbol: str, quantity: int):
            raise RuntimeError("synthetic broker failure")

    monkeypatch.setattr(service, "broker", BrokenBroker())
    with pytest.raises(RuntimeError):
        service.fill(db, submitted.id)
    db.expire_all()
    refreshed = db.get(Order, submitted.id)
    account = db.get(Account, service.ACCOUNT_ID)
    assert refreshed and refreshed.status == "SUBMITTED"
    assert (
        account
        and account.cash == Decimal("10000.00")
        and account.reserved_cash == Decimal("100.00")
    )
    assert len(db.scalars(select(Event)).all()) == before_events


def test_changed_execution_price_rolls_back(db, monkeypatch: pytest.MonkeyPatch):
    submitted = order(db, "changed-price", quantity=1)

    class WrongPriceBroker:
        def quote(self, symbol: str) -> Decimal:
            return Decimal("100.00")

        def fill(self, symbol: str, quantity: int):
            return MockExecution(Decimal("99.00"), quantity)

    monkeypatch.setattr(service, "broker", WrongPriceBroker())
    with pytest.raises(ValueError, match="reserved fixed price"):
        service.fill(db, submitted.id)
    db.expire_all()
    assert db.get(Order, submitted.id).status == "SUBMITTED"
    assert db.scalar(select(Fill).where(Fill.order_id == submitted.id)) is None


def test_seed_is_idempotent_and_does_not_reset_balance(db):
    account = db.get(Account, service.ACCOUNT_ID)
    assert account
    account.cash = Decimal("321.00")
    db.commit()
    service.seed(db)
    account = db.get(Account, service.ACCOUNT_ID)
    assert account and account.cash == Decimal("321.00")


def test_fill_retry_creates_exactly_one_fill_and_event(db):
    submitted = order(db, "one-fill", quantity=1)
    service.fill(db, submitted.id)
    service.fill(db, submitted.id)
    assert len(db.scalars(select(Fill).where(Fill.order_id == submitted.id)).all()) == 1
    assert (
        len(
            db.scalars(
                select(Event).where(Event.order_id == submitted.id, Event.type == "FILLED")
            ).all()
        )
        == 1
    )
