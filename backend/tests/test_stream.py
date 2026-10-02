import asyncio
import json

from app import main, service
from app.schemas import OrderIn


def test_stream_replays_after_cursor_then_heartbeats_and_closes(monkeypatch, db_factory):
    with db_factory() as db:
        service.submit(db, OrderIn(symbol="DEMO", side="BUY", quantity=1), "stream-test")
        rows = main.stream_events(db, 0)
        cursor = rows[0].id
        expected_ids = [event.id for event in rows[1:]]
    monkeypatch.setattr(main, "SessionLocal", db_factory)

    class Connection:
        calls = 0

        async def is_disconnected(self):
            self.calls += 1
            return self.calls > 2

    async def no_wait(_):
        return None

    monkeypatch.setattr(main.asyncio, "sleep", no_wait)

    async def receive():
        response = await main.event_stream(Connection(), str(cursor))
        assert response.headers["X-Accel-Buffering"] == "no"
        return [message async for message in response.body_iterator]

    messages = asyncio.run(receive())
    records = [json.loads(message.split("data: ")[1]) for message in messages]
    assert [record["id"] for record in records if "id" in record] == expected_ids
    assert messages[-1] == "event: heartbeat\ndata: {}\n\n"


def test_stream_bad_cursor_starts_from_zero(monkeypatch, db_factory):
    monkeypatch.setattr(main, "SessionLocal", db_factory)

    class Disconnected:
        async def is_disconnected(self):
            return True

    async def receive():
        response = await main.event_stream(Disconnected(), "not-an-integer")
        return [message async for message in response.body_iterator]

    assert asyncio.run(receive()) == []
