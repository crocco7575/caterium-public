from concurrent.futures import ThreadPoolExecutor


def run(client, key="paper-1", strategy_id="example-yes"):
    return client.post(
        "/api/v1/paper/runs",
        headers={"Idempotency-Key": key},
        json={"strategy_id": strategy_id},
    )


def test_paper_dashboard_starts_empty_and_does_not_touch_account(client):
    before = client.get("/api/v1/account").json()
    dashboard = client.get("/api/v1/paper/dashboard").json()
    assert dashboard["demo"] is True
    assert dashboard["mode"] == "synthetic_fixture"
    assert dashboard["delivery"] == "preview_only"
    assert len(dashboard["strategies"]) == 2
    assert dashboard["runs"] == []
    assert client.get("/api/v1/account").json() == before


def test_paper_run_golden_counts_arithmetic_and_alert_previews(client):
    response = run(client)
    assert response.status_code == 201
    payload = response.json()
    summary = payload["summary"]
    assert summary["markets"] == 12
    assert summary["signals"] == 10
    assert (summary["filled"], summary["unfilled"], summary["skipped"]) == (8, 2, 2)
    assert summary["wins"] + summary["losses"] == summary["filled"]
    assert summary["pnl_cents"] == sum(
        row["pnl_cents"] for row in payload["ledger"] if row["status"] == "FILLED"
    )
    assert summary["wins"] == 5
    assert summary["losses"] == 3
    assert summary["pnl_cents"] == 116
    assert summary["all_signal_pnl_cents"] == 120
    assert summary["max_drawdown_cents"] == 96
    assert [point["pnl_cents"] for point in payload["equity"]] == [
        0,
        52,
        104,
        156,
        108,
        60,
        112,
        164,
        116,
    ]
    assert all(
        row["pnl_cents"] is None
        for row in payload["ledger"]
        if row["status"] in {"UNFILLED", "SKIPPED"}
    )
    assert all(alert["delivery"] == "preview_only" for alert in payload["alerts"])
    assert len(payload["alerts"]) == 10


def test_paper_retry_conflict_and_strict_input(client):
    first = run(client, key="same-paper", strategy_id="example-no")
    retry = run(client, key="same-paper", strategy_id="example-no")
    assert first.status_code == retry.status_code == 201
    assert first.json() == retry.json()
    assert run(client, key="same-paper", strategy_id="example-yes").status_code == 409
    assert (
        client.post(
            "/api/v1/paper/runs",
            headers={"Idempotency-Key": "extra"},
            json={"strategy_id": "example-yes", "unexpected": True},
        ).status_code
        == 422
    )


def test_paper_no_baseline_golden_stats(client):
    payload = run(client, key="golden-no", strategy_id="example-no").json()
    assert payload["summary"] == {
        "markets": 12,
        "signals": 10,
        "filled": 8,
        "unfilled": 2,
        "skipped": 2,
        "wins": 3,
        "losses": 5,
        "win_rate": 0.375,
        "pnl_cents": -116,
        "all_signal_pnl_cents": -120,
        "max_drawdown_cents": 164,
    }
    assert [point["pnl_cents"] for point in payload["equity"]] == [
        0,
        -52,
        -104,
        -156,
        -108,
        -60,
        -112,
        -164,
        -116,
    ]
    assert client.post("/api/v1/paper/runs", json={"strategy_id": "example-yes"}).status_code == 422
    assert (
        client.post(
            "/api/v1/paper/runs",
            headers={"Idempotency-Key": " "},
            json={"strategy_id": "example-yes"},
        ).status_code
        == 422
    )
    assert (
        client.post(
            "/api/v1/paper/runs",
            headers={"Idempotency-Key": "x" * 129},
            json={"strategy_id": "example-yes"},
        ).status_code
        == 422
    )


def test_paper_history_does_not_double_count_retries(client):
    first = run(client, key="history-1")
    run(client, key="history-1")
    second = run(client, key="history-2", strategy_id="example-no")
    assert first.status_code == second.status_code == 201
    history = client.get("/api/v1/paper/dashboard").json()["runs"]
    assert len(history) == 2
    assert {item["strategy_id"] for item in history} == {"example-yes", "example-no"}


def test_unknown_strategy_and_wrong_type_are_rejected(client):
    for invalid in ("private-rule", None, 42):
        response = client.post(
            "/api/v1/paper/runs",
            headers={"Idempotency-Key": "invalid-strategy"},
            json={"strategy_id": invalid},
        )
        assert response.status_code == 422
    assert client.get("/api/v1/paper/dashboard").json()["runs"] == []


def test_paper_history_is_bounded_to_twenty_runs(client):
    for index in range(21):
        assert run(client, key=f"bounded-{index}").status_code == 201
    assert len(client.get("/api/v1/paper/dashboard").json()["runs"]) == 20


def test_concurrent_same_key_returns_one_run_and_conflict_is_safe(client):
    with ThreadPoolExecutor(max_workers=2) as pool:
        responses = list(pool.map(lambda _: run(client, key="parallel"), range(2)))
    assert {response.status_code for response in responses} == {201}
    assert responses[0].json() == responses[1].json()
    assert run(client, key="parallel", strategy_id="example-no").status_code == 409


def test_paper_does_not_mutate_any_demo_accounts_or_ledgers(client):
    before_equity = {
        "account": client.get("/api/v1/account").json(),
        "positions": client.get("/api/v1/positions").json(),
        "orders": client.get("/api/v1/orders").json(),
    }
    before_prediction = client.get("/api/v1/prediction/dashboard").json()
    assert run(client, key="isolation-yes").status_code == 201
    assert run(client, key="isolation-no", strategy_id="example-no").status_code == 201
    assert {
        "account": client.get("/api/v1/account").json(),
        "positions": client.get("/api/v1/positions").json(),
        "orders": client.get("/api/v1/orders").json(),
    } == before_equity
    after_prediction = client.get("/api/v1/prediction/dashboard").json()
    assert after_prediction["account"] == before_prediction["account"]
    assert after_prediction["positions"] == before_prediction["positions"]
    assert after_prediction["orders"] == before_prediction["orders"]
