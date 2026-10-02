from app import main
from app.db import get_db


def submit(c, key="key", symbol="DEMO", side="BUY", quantity=1):
    return c.post(
        "/api/v1/orders",
        headers={"Idempotency-Key": key},
        json={"symbol": symbol, "side": side, "quantity": quantity},
    )


def test_contract_health_dashboard_and_strategy(client):
    assert client.get("/api/v1/health").json() == {"status": "ok", "demo": True, "database": "ok"}
    dashboard = client.get("/api/v1/dashboard").json()
    assert dashboard["account"]["id"] == "demo-account"
    assert client.get("/api/v1/strategies").json()[0]["status"] == "DEMO_ONLY"
    run = client.post("/api/v1/strategies/example/run", headers={"Idempotency-Key": "strategy-1"})
    assert run.status_code == 201 and run.json()["symbol"] == "DEMO"


def test_buy_reservation_fill_and_retries(client):
    created = submit(client, quantity=2)
    assert created.status_code == 201
    assert created.json()["created_at"].endswith("Z")
    assert client.get("/api/v1/account").json()["reserved_cash"] == "200.00"
    order_id = created.json()["id"]
    filled = client.post(f"/api/v1/orders/{order_id}/fill")
    assert filled.json()["status"] == "FILLED"
    assert filled.json()["updated_at"].endswith("Z")
    assert client.post(f"/api/v1/orders/{order_id}/fill").json()["status"] == "FILLED"
    account = client.get("/api/v1/account").json()
    assert account["cash"] == "9800.00" and account["reserved_cash"] == "0.00"
    assert client.post(f"/api/v1/orders/{order_id}/cancel").status_code == 409


def test_cancel_releases_reservation_and_retries(client):
    order = submit(client, key="cancel", quantity=3).json()
    response = client.post(f"/api/v1/orders/{order['id']}/cancel")
    assert response.json()["status"] == "CANCELLED"
    assert client.post(f"/api/v1/orders/{order['id']}/cancel").json()["status"] == "CANCELLED"
    assert client.get("/api/v1/account").json()["reserved_cash"] == "0.00"


def test_idempotency_same_retry_and_conflict(client):
    first = submit(client, key="same", quantity=1).json()
    retry = submit(client, key="same", quantity=1)
    assert retry.status_code == 201 and retry.json()["id"] == first["id"]
    assert submit(client, key="same", quantity=2).status_code == 409


def test_reject_overspend_and_oversell_without_reservation(client):
    rejected_buy = submit(client, key="too-much", quantity=101)
    assert rejected_buy.json()["status"] == "REJECTED"
    assert rejected_buy.json()["rejection_reason"] == "INSUFFICIENT_CASH"
    rejected_sell = submit(client, key="short", side="SELL", quantity=1)
    assert rejected_sell.json()["status"] == "REJECTED"
    assert rejected_sell.json()["rejection_reason"] == "INSUFFICIENT_POSITION"
    assert client.get("/api/v1/account").json()["reserved_cash"] == "0.00"


def test_sell_inventory_reservation_and_basis(client):
    buy = submit(client, key="basis-buy", quantity=2).json()
    client.post(f"/api/v1/orders/{buy['id']}/fill")
    sell = submit(client, key="basis-sell", side="SELL", quantity=1).json()
    assert client.get("/api/v1/positions").json()[0]["reserved_quantity"] == 1
    client.post(f"/api/v1/orders/{sell['id']}/fill")
    position = client.get("/api/v1/positions").json()[0]
    assert position["quantity"] == 1 and position["average_price"] == "100.00"


def test_request_validation_and_missing_order(client):
    assert (
        client.post(
            "/api/v1/orders", json={"symbol": "DEMO", "side": "BUY", "quantity": 1}
        ).status_code
        == 422
    )
    assert submit(client, key="bad", quantity=0).status_code == 422
    assert submit(client, key="bool", quantity=True).status_code == 422
    assert submit(client, key="float", quantity=1.5).status_code == 422
    assert submit(client, key="string", quantity="1").status_code == 422
    assert (
        client.post(
            "/api/v1/orders",
            headers={"Idempotency-Key": "   "},
            json={"symbol": "DEMO", "side": "BUY", "quantity": 1},
        ).status_code
        == 422
    )
    assert (
        client.post(
            "/api/v1/orders",
            headers={"Idempotency-Key": "bad"},
            json={"symbol": "NOPE", "side": "BUY", "quantity": 1},
        ).status_code
        == 422
    )
    assert client.post("/api/v1/orders/no-such/fill").status_code == 404


def test_events_are_persisted_and_sse_honors_cursor(client):
    order = submit(client, key="events").json()
    response = client.get("/api/v1/events")
    assert len(response.json()) >= 3
    event_id = response.json()[-1]["id"]
    formatted = main.format_sse("domain", {"id": event_id}, event_id)
    assert formatted.startswith("event: domain\nid: ")
    assert order["id"] in response.text


def test_failed_db_health_is_safe(monkeypatch, client):
    def broken():
        class Broken:
            def execute(self, _):
                raise RuntimeError("offline")

        yield Broken()

    main.app.dependency_overrides[get_db] = broken
    assert client.get("/api/v1/health").status_code == 503
