"""Contract tests for the isolated synthetic prediction-market ledger."""

import os
from concurrent.futures import ThreadPoolExecutor
from decimal import Decimal

import pytest

from app import prediction_service
from app.schemas import PredictionOrderIn


def pred(c, key, market="demo-launch", outcome="YES", quantity=1, **extra):
    body = {"market_id": market, "outcome": outcome, "quantity": quantity, **extra}
    return c.post("/api/v1/prediction/orders", headers={"Idempotency-Key": key}, json=body)


def test_dashboard_seed_and_equity_isolation(client):
    d = client.get("/api/v1/prediction/dashboard").json()
    assert d["account"] == {
        "id": "prediction-demo-account",
        "cash": "1000.00",
        "reserved_cash": "0.00",
        "available_cash": "1000.00",
        "equity": "1000.00",
        "currency": "USD",
    }
    assert {m["id"] for m in d["markets"]} == {"demo-launch", "demo-rain"}
    assert client.get("/api/v1/account").json()["id"] == "demo-account"
    order = pred(client, "isolation", quantity=1).json()
    client.post(f"/api/v1/prediction/orders/{order['id']}/fill")
    assert client.get("/api/v1/account").json()["cash"] == "10000.00"


def test_locked_account_refreshes_retained_identity(client, db):
    retained = db.get(prediction_service.Account, prediction_service.PREDICTION_ACCOUNT_ID)
    assert retained is not None and retained.cash == Decimal("1000.00")
    order = pred(client, "retained", quantity=1).json()
    client.post(f"/api/v1/prediction/orders/{order['id']}/fill")
    with prediction_service.locked_account(db) as refreshed:
        assert refreshed.cash == Decimal("999.60")


def test_yes_winner_and_no_loser_settlement(client):
    yes = pred(client, "winner", outcome="YES", quantity=2).json()
    no = pred(client, "loser", outcome="NO", quantity=3).json()
    assert client.post(f"/api/v1/prediction/orders/{yes['id']}/fill").status_code == 200
    assert client.post(f"/api/v1/prediction/orders/{no['id']}/fill").status_code == 200
    assert (
        client.post(
            "/api/v1/prediction/markets/demo-launch/settle", json={"result": "YES"}
        ).status_code
        == 200
    )
    positions = {
        p["outcome"]: p for p in client.get("/api/v1/prediction/dashboard").json()["positions"]
    }
    assert positions["YES"] == {
        "market_id": "demo-launch",
        "outcome": "YES",
        "quantity": 2,
        "cost_basis": "0.80",
        "market_value": "0.00",
        "settled": True,
        "payout": "2.00",
    }
    assert positions["NO"]["payout"] == "0.00"
    assert client.get("/api/v1/prediction/dashboard").json()["realized_pnl"] == "-0.60"


def test_no_winner_and_yes_loser_repeat_settlement(client):
    yes = pred(client, "yes-loser", market="demo-rain", quantity=2).json()
    no = pred(client, "no-winner", market="demo-rain", outcome="NO", quantity=2).json()
    client.post(f"/api/v1/prediction/orders/{yes['id']}/fill")
    client.post(f"/api/v1/prediction/orders/{no['id']}/fill")
    settle = "/api/v1/prediction/markets/demo-rain/settle"
    assert client.post(settle, json={"result": "NO"}).status_code == 200
    assert client.post(settle, json={"result": "NO"}).status_code == 200
    d = client.get("/api/v1/prediction/dashboard").json()
    positions = {p["outcome"]: p for p in d["positions"]}
    assert positions["NO"]["payout"] == "2.00"
    assert positions["YES"]["payout"] == "0.00"
    assert d["account"]["cash"] == "1000.00"
    assert sum(e["type"] == "SETTLED" for e in d["events"]) == 1


def test_pending_orders_cancelled_and_no_empty_positions(client):
    order = pred(client, "pending", quantity=2).json()
    assert (
        client.post(
            "/api/v1/prediction/markets/demo-launch/settle", json={"result": "NO"}
        ).status_code
        == 200
    )
    assert client.get(f"/api/v1/prediction/orders/{order['id']}").status_code == 404
    d = client.get("/api/v1/prediction/dashboard").json()
    assert d["orders"][0]["status"] == "CANCELLED" and d["positions"] == []
    assert d["account"]["reserved_cash"] == "0.00"


def test_settlement_retry_and_conflict_are_safe(client):
    pending = pred(client, "closed-retry")
    assert pending.status_code == 201
    assert (
        client.post(
            "/api/v1/prediction/markets/demo-launch/settle", json={"result": "YES"}
        ).status_code
        == 200
    )
    assert (
        client.post(
            "/api/v1/prediction/markets/demo-launch/settle", json={"result": "YES"}
        ).status_code
        == 200
    )
    assert (
        client.post(
            "/api/v1/prediction/markets/demo-launch/settle", json={"result": "NO"}
        ).status_code
        == 409
    )
    events = client.get("/api/v1/prediction/dashboard").json()["events"]
    assert sum(e["type"] == "SETTLED" for e in events) == 1
    assert pred(client, "closed-retry").status_code == 201
    assert pred(client, "closed-new").status_code == 409


def test_fill_cancel_retries_and_terminal_transitions(client):
    o = pred(client, "terminal").json()
    path = f"/api/v1/prediction/orders/{o['id']}"
    assert client.post(path + "/fill").json()["status"] == "FILLED"
    assert client.post(path + "/fill").json()["status"] == "FILLED"
    assert client.post(path + "/cancel").status_code == 409
    o2 = pred(client, "cancel-terminal").json()
    path2 = f"/api/v1/prediction/orders/{o2['id']}"
    assert client.post(path2 + "/cancel").json()["status"] == "CANCELLED"
    assert client.post(path2 + "/cancel").json()["status"] == "CANCELLED"
    assert client.post(path2 + "/fill").status_code == 409


def test_idempotency_strict_validation_and_unknowns(client):
    first = pred(client, "retry", quantity=2).json()
    assert pred(client, "retry", quantity=2).json()["id"] == first["id"]
    assert pred(client, "retry", quantity=3).status_code == 409
    assert pred(client, "extra", nope=1).status_code == 422
    for value in (0, -1, 1.2, True, "1", 1_000_001):
        assert pred(client, str(value), quantity=value).status_code == 422
    assert pred(client, "unknown", market="missing").status_code == 404
    assert (
        client.post(
            "/api/v1/prediction/orders",
            json={"market_id": "demo-launch", "outcome": "YES", "quantity": 1},
        ).status_code
        == 422
    )
    assert client.post("/api/v1/prediction/orders/no-order/fill").status_code == 404
    assert client.post("/api/v1/prediction/orders/no-order/cancel").status_code == 404


def test_insufficient_cash_is_rejected_without_reservation(client):
    response = pred(client, "overspend", quantity=1_000_000)
    assert response.status_code == 201 and response.json()["status"] == "REJECTED"
    assert response.json()["rejection_reason"] == "INSUFFICIENT_CASH"
    assert client.get("/api/v1/prediction/dashboard").json()["account"]["reserved_cash"] == "0.00"


def test_aggregate_holdings_and_seed_preservation(client, db):
    a = pred(client, "aggregate-a", quantity=2).json()
    b = pred(client, "aggregate-b", quantity=3).json()
    client.post(f"/api/v1/prediction/orders/{a['id']}/fill")
    client.post(f"/api/v1/prediction/orders/{b['id']}/fill")
    p = [
        x
        for x in client.get("/api/v1/prediction/dashboard").json()["positions"]
        if x["outcome"] == "YES"
    ][0]
    assert p["quantity"] == 5 and p["cost_basis"] == "2.00"
    db.expire_all()
    account = db.get(prediction_service.Account, prediction_service.PREDICTION_ACCOUNT_ID)
    assert account is not None and account.cash == Decimal("998.00")
    client.post("/api/v1/prediction/markets/demo-launch/settle", json={"result": "YES"})
    prediction_service.seed(db)
    prediction_service.seed(db)
    db.expire_all()
    market = db.get(prediction_service.PredictionMarket, "demo-launch")
    account = db.get(prediction_service.Account, prediction_service.PREDICTION_ACCOUNT_ID)
    assert market is not None and market.status == "SETTLED" and market.result == "YES"
    assert account is not None and account.cash == Decimal("1003.00")


def test_failed_event_write_rolls_back_everything(client, monkeypatch):
    def fail(*args, **kwargs):
        raise RuntimeError("event sink unavailable")

    monkeypatch.setattr(prediction_service, "event", fail)
    with pytest.raises(RuntimeError, match="event sink unavailable"):
        pred(client, "rollback")
    monkeypatch.undo()
    assert client.get("/api/v1/prediction/dashboard").json()["orders"] == []
    assert client.get("/api/v1/prediction/dashboard").json()["account"]["reserved_cash"] == "0.00"


def test_failed_settlement_event_rolls_back_payout_and_state(client, monkeypatch):
    order = pred(client, "settle-rollback", quantity=1).json()
    client.post(f"/api/v1/prediction/orders/{order['id']}/fill")
    original = prediction_service.event

    def fail_settlement(db, typ, order_id, market_id, message):
        if typ == "SETTLED":
            raise RuntimeError("settlement event unavailable")
        return original(db, typ, order_id, market_id, message)

    monkeypatch.setattr(prediction_service, "event", fail_settlement)
    with pytest.raises(RuntimeError, match="settlement event unavailable"):
        client.post("/api/v1/prediction/markets/demo-launch/settle", json={"result": "YES"})
    monkeypatch.undo()
    d = client.get("/api/v1/prediction/dashboard").json()
    assert d["markets"][0]["status"] == "OPEN"
    assert d["positions"][0]["settled"] is False
    assert d["account"]["cash"] == "999.60"


@pytest.mark.skipif("TEST_DATABASE_URL" not in os.environ, reason="requires local PostgreSQL")
def test_postgres_fill_vs_settlement_is_consistent(db_factory):
    with db_factory() as db:
        order = prediction_service.submit(
            db, PredictionOrderIn(market_id="demo-launch", outcome="YES", quantity=1), "pg-race"
        )

    def do_fill():
        with db_factory() as db:
            try:
                return prediction_service.fill(db, order.id).status
            except ValueError:
                return "SETTLED"

    def do_settle():
        with db_factory() as db:
            try:
                return prediction_service.settle(db, "demo-launch", "YES").status
            except ValueError:
                return "FILLED"

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = [f.result() for f in (pool.submit(do_fill), pool.submit(do_settle))]
    assert set(results) == {"FILLED", "SETTLED"}
    with db_factory() as db:
        market = db.get(prediction_service.PredictionMarket, "demo-launch")
        assert market is not None and market.status == "SETTLED"


@pytest.mark.skipif("TEST_DATABASE_URL" not in os.environ, reason="requires local PostgreSQL")
def test_postgres_concurrent_settlement_retries_are_idempotent(db_factory):
    with db_factory() as db:
        order = prediction_service.submit(
            db, PredictionOrderIn(market_id="demo-launch", outcome="YES", quantity=1), "pg-settle"
        )
        prediction_service.fill(db, order.id)

    def do_settle():
        with db_factory() as db:
            return prediction_service.settle(db, "demo-launch", "YES").result

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = [f.result() for f in (pool.submit(do_settle), pool.submit(do_settle))]
    assert results == ["YES", "YES"]
    with db_factory() as db:
        rows = list(db.scalars(prediction_service.select(prediction_service.PredictionEvent)).all())
        position = db.get(prediction_service.PredictionPosition, ("demo-launch", "YES"))
        assert position is not None and position.payout == Decimal("1.00")
        assert sum(row.type == "SETTLED" for row in rows) == 1
