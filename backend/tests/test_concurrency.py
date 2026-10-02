import os
from concurrent.futures import ThreadPoolExecutor

import pytest
from sqlalchemy import select

from app import service
from app.models import Account, Event, Fill, Order
from app.schemas import OrderIn

pytestmark = pytest.mark.skipif(
    not os.getenv("TEST_DATABASE_URL"),
    reason="PostgreSQL concurrency tests require TEST_DATABASE_URL",
)


def test_same_key_concurrent_submit_one_order(db_factory):
    maker = db_factory

    def submit_once():
        with maker() as db:
            return service.submit(db, OrderIn(symbol="DEMO", side="BUY", quantity=1), "race-key").id

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _: submit_once(), range(2)))
    with maker() as db:
        orders = db.scalars(select(Order)).all()
        account = db.get(Account, service.ACCOUNT_ID)
        assert account and account.reserved_cash == 100
    assert len(set(results)) == 1 and len(orders) == 1


def test_concurrent_fill_only_one_fill(db_factory):
    maker = db_factory
    with maker() as db:
        submitted = service.submit(db, OrderIn(symbol="DEMO", side="BUY", quantity=1), "fill-race")

    def fill_once():
        with maker() as db:
            return service.fill(db, submitted.id).status

    with ThreadPoolExecutor(max_workers=2) as pool:
        assert list(pool.map(lambda _: fill_once(), range(2))) == ["FILLED", "FILLED"]
    with maker() as db:
        assert len(db.scalars(select(Fill).where(Fill.order_id == submitted.id)).all()) == 1
        assert (
            len(
                db.scalars(
                    select(Event).where(Event.order_id == submitted.id, Event.type == "FILLED")
                ).all()
            )
            == 1
        )


def test_fill_cancel_race_has_one_terminal_state(db_factory):
    maker = db_factory
    with maker() as db:
        submitted = service.submit(
            db, OrderIn(symbol="DEMO", side="BUY", quantity=1), "terminal-race"
        )

    def act(name):
        with maker() as db:
            try:
                return getattr(service, name)(db, submitted.id).status
            except ValueError:
                return "CONFLICT"

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(act, ("fill", "cancel")))
    with maker() as db:
        current = db.get(Order, submitted.id)
        events = db.scalars(select(Event).where(Event.order_id == submitted.id)).all()
        account = db.get(Account, service.ACCOUNT_ID)
        assert account and account.reserved_cash == 0
        assert account.cash in {9900, 10000}
    assert current and current.status in {"FILLED", "CANCELLED"}
    assert sum(result in {"FILLED", "CANCELLED"} for result in results) == 1
    assert len({event.id for event in events}) == len(events)
