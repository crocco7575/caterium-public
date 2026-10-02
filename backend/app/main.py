import asyncio
import json
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from decimal import Decimal

from fastapi import Depends, FastAPI, Header, HTTPException, Request, status
from fastapi.responses import StreamingResponse
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from app.db import SessionLocal, get_db
from app.models import (
    Account,
    Event,
    Order,
    Position,
    PredictionEvent,
    PredictionMarket,
    PredictionOrder,
    PredictionPosition,
)
from app.paper_service import dashboard as paper_dashboard_data
from app.paper_service import run as run_paper_strategy
from app.prediction_service import PREDICTION_ACCOUNT_ID
from app.prediction_service import cancel as prediction_cancel
from app.prediction_service import fill as prediction_fill
from app.prediction_service import price as prediction_price
from app.prediction_service import settle as prediction_settle
from app.prediction_service import submit as prediction_submit
from app.schemas import (
    AccountOut,
    DashboardOut,
    EventOut,
    OrderIn,
    OrderOut,
    PaperDashboardOut,
    PaperRunIn,
    PaperRunOut,
    PositionOut,
    PredictionAccountOut,
    PredictionDashboardOut,
    PredictionEventOut,
    PredictionMarketOut,
    PredictionOrderIn,
    PredictionOrderOut,
    PredictionPositionOut,
    PredictionSettlementIn,
    StrategyOut,
)
from app.service import ACCOUNT_ID, broker, cancel, fill, seed, submit
from app.strategy import ExampleStrategy

EXAMPLE_STRATEGY = ExampleStrategy()
STRATEGY = EXAMPLE_STRATEGY.descriptor


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    with SessionLocal() as db:
        seed(db)
    yield


app = FastAPI(title="Caterium Public Demo", version="1.0", lifespan=lifespan)


def format_sse(event: str, payload: dict[str, object], event_id: int | None = None) -> str:
    identifier = f"id: {event_id}\n" if event_id is not None else ""
    return f"event: {event}\n{identifier}data: {json.dumps(payload)}\n\n"


def stream_events(db: Session, cursor: int, limit: int = 25) -> list[Event]:
    return list(
        db.scalars(select(Event).where(Event.id > cursor).order_by(Event.id).limit(limit)).all()
    )


def account_out(db: Session) -> AccountOut:
    a = db.get(Account, ACCOUNT_ID)
    assert a
    positions = db.scalars(select(Position)).all()
    equity = a.cash + sum(
        (p.quantity * broker.quote(p.symbol) for p in positions), start=a.reserved_cash * 0
    )
    return AccountOut(
        id=a.id,
        cash=a.cash,
        reserved_cash=a.reserved_cash,
        available_cash=a.cash - a.reserved_cash,
        equity=equity,
        currency=a.currency,
    )


def position_out(p: Position) -> PositionOut:
    price = broker.quote(p.symbol)
    return PositionOut(
        symbol=p.symbol,
        quantity=p.quantity,
        reserved_quantity=p.reserved_quantity,
        average_price=p.average_price,
        market_price=price,
        market_value=p.quantity * price,
    )


def fail(exc: Exception) -> HTTPException:
    if isinstance(exc, KeyError):
        return HTTPException(404, "order not found")
    return HTTPException(409, str(exc))


@app.get("/api/v1/health")
def health(db: Session = Depends(get_db)) -> dict[str, object]:
    try:
        db.execute(text("SELECT 1"))
        return {"status": "ok", "demo": True, "database": "ok"}
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="database unavailable"
        ) from None


@app.get("/api/v1/account", response_model=AccountOut)
def account(db: Session = Depends(get_db)) -> AccountOut:
    return account_out(db)


@app.get("/api/v1/positions", response_model=list[PositionOut])
def positions(db: Session = Depends(get_db)) -> list[PositionOut]:
    return [
        position_out(p)
        for p in db.scalars(select(Position)).all()
        if p.quantity or p.reserved_quantity
    ]


@app.get("/api/v1/orders", response_model=list[OrderOut])
def orders(db: Session = Depends(get_db)) -> list[OrderOut]:
    return [
        OrderOut.model_validate(order)
        for order in db.scalars(select(Order).order_by(Order.created_at.desc()).limit(100)).all()
    ]


@app.get("/api/v1/events", response_model=list[EventOut])
def events(db: Session = Depends(get_db)) -> list[EventOut]:
    return [
        EventOut.model_validate(event)
        for event in db.scalars(select(Event).order_by(Event.id.desc()).limit(50)).all()
    ]


@app.get("/api/v1/strategies", response_model=list[StrategyOut])
def strategies() -> list[StrategyOut]:
    return [STRATEGY]


@app.get("/api/v1/dashboard")
def dashboard(db: Session = Depends(get_db)) -> DashboardOut:
    return DashboardOut(
        demo=True,
        account=account_out(db),
        positions=[
            position_out(p)
            for p in db.scalars(select(Position)).all()
            if p.quantity or p.reserved_quantity
        ],
        orders=orders(db),
        events=events(db),
        strategy=STRATEGY,
    )


@app.post("/api/v1/orders", response_model=OrderOut, status_code=201)
def create_order(
    body: OrderIn,
    idempotency_key: str | None = Header(None, alias="Idempotency-Key"),
    db: Session = Depends(get_db),
) -> OrderOut:
    if not idempotency_key or not idempotency_key.strip() or len(idempotency_key) > 128:
        raise HTTPException(422, "Idempotency-Key is required and must be 1-128 characters")
    try:
        return OrderOut.model_validate(submit(db, body, idempotency_key))
    except ValueError as e:
        raise HTTPException(409, str(e)) from e


@app.post("/api/v1/orders/{order_id}/fill", response_model=OrderOut)
def fill_order(order_id: str, db: Session = Depends(get_db)) -> OrderOut:
    try:
        return OrderOut.model_validate(fill(db, order_id))
    except (KeyError, ValueError) as e:
        raise fail(e) from e


@app.post("/api/v1/orders/{order_id}/cancel", response_model=OrderOut)
def cancel_order(order_id: str, db: Session = Depends(get_db)) -> OrderOut:
    try:
        return OrderOut.model_validate(cancel(db, order_id))
    except (KeyError, ValueError) as e:
        raise fail(e) from e


@app.post("/api/v1/strategies/example/run", response_model=OrderOut, status_code=201)
def run_strategy(
    idempotency_key: str | None = Header(None, alias="Idempotency-Key"),
    db: Session = Depends(get_db),
) -> OrderOut:
    if not idempotency_key or not idempotency_key.strip() or len(idempotency_key) > 128:
        raise HTTPException(422, "Idempotency-Key is required")
    try:
        return OrderOut.model_validate(submit(db, EXAMPLE_STRATEGY.propose(), idempotency_key))
    except ValueError as e:
        raise HTTPException(409, str(e)) from e


@app.get("/api/v1/paper/dashboard", response_model=PaperDashboardOut)
def paper_dashboard(db: Session = Depends(get_db)) -> PaperDashboardOut:
    return PaperDashboardOut.model_validate(paper_dashboard_data(db))


@app.post("/api/v1/paper/runs", response_model=PaperRunOut, status_code=201)
def create_paper_run(
    body: PaperRunIn,
    idempotency_key: str | None = Header(None, alias="Idempotency-Key"),
    db: Session = Depends(get_db),
) -> PaperRunOut:
    if not idempotency_key or not idempotency_key.strip() or len(idempotency_key) > 128:
        raise HTTPException(422, "Idempotency-Key is required and must be 1-128 characters")
    try:
        return PaperRunOut.model_validate(run_paper_strategy(db, body.strategy_id, idempotency_key))
    except ValueError as exc:
        if str(exc) == "unknown strategy_id":
            raise HTTPException(422, str(exc)) from exc
        raise HTTPException(409, str(exc)) from exc


def prediction_dashboard_data(db: Session) -> PredictionDashboardOut:
    account = db.get(Account, PREDICTION_ACCOUNT_ID)
    assert account
    markets = list(db.scalars(select(PredictionMarket).order_by(PredictionMarket.id)).all())
    positions = list(db.scalars(select(PredictionPosition)).all())
    market_by_id = {m.id: m for m in markets}
    pos_out = []
    for p in positions:
        m = market_by_id[p.market_id]
        value = Decimal("0.00") if p.settled else p.quantity * prediction_price(m, p.outcome)
        pos_out.append(
            PredictionPositionOut(
                market_id=p.market_id,
                outcome=p.outcome,
                quantity=p.quantity,
                cost_basis=p.cost_basis,
                market_value=value,
                settled=p.settled,
                payout=p.payout,
            )
        )
    equity = account.cash + sum((x.market_value for x in pos_out), start=Decimal("0.00"))
    realized = sum((p.payout - p.cost_basis for p in positions if p.settled), start=Decimal("0.00"))
    return PredictionDashboardOut(
        demo=True,
        account=PredictionAccountOut(
            id=account.id,
            cash=account.cash,
            reserved_cash=account.reserved_cash,
            available_cash=account.cash - account.reserved_cash,
            equity=equity,
            currency=account.currency,
        ),
        markets=[
            PredictionMarketOut(
                id=m.id,
                title=m.title,
                yes_price=m.yes_price,
                no_price=Decimal("1.00") - m.yes_price,
                status=m.status,
                result=m.result,
            )
            for m in markets
        ],
        orders=[
            PredictionOrderOut.model_validate(x)
            for x in db.scalars(
                select(PredictionOrder).order_by(PredictionOrder.created_at.desc()).limit(100)
            ).all()
        ],
        positions=pos_out,
        events=[
            PredictionEventOut.model_validate(x)
            for x in db.scalars(
                select(PredictionEvent).order_by(PredictionEvent.id.desc()).limit(50)
            ).all()
        ],
        realized_pnl=realized,
    )


@app.get("/api/v1/prediction/dashboard", response_model=PredictionDashboardOut)
def prediction_dashboard(db: Session = Depends(get_db)) -> PredictionDashboardOut:
    return prediction_dashboard_data(db)


@app.get("/api/v1/prediction/markets", response_model=list[PredictionMarketOut])
def prediction_markets(db: Session = Depends(get_db)) -> list[PredictionMarketOut]:
    return [
        PredictionMarketOut(
            id=m.id,
            title=m.title,
            yes_price=m.yes_price,
            no_price=Decimal("1.00") - m.yes_price,
            status=m.status,
            result=m.result,
        )
        for m in db.scalars(select(PredictionMarket).order_by(PredictionMarket.id)).all()
    ]


@app.post("/api/v1/prediction/orders", response_model=PredictionOrderOut, status_code=201)
def create_prediction_order(
    body: PredictionOrderIn,
    idempotency_key: str | None = Header(None, alias="Idempotency-Key"),
    db: Session = Depends(get_db),
) -> PredictionOrderOut:
    if not idempotency_key or not idempotency_key.strip() or len(idempotency_key) > 128:
        raise HTTPException(422, "Idempotency-Key is required and must be 1-128 characters")
    try:
        return PredictionOrderOut.model_validate(prediction_submit(db, body, idempotency_key))
    except KeyError:
        raise HTTPException(404, "market not found") from None
    except ValueError as e:
        raise HTTPException(409, str(e)) from e


@app.post("/api/v1/prediction/orders/{order_id}/fill", response_model=PredictionOrderOut)
def fill_prediction_order(order_id: str, db: Session = Depends(get_db)) -> PredictionOrderOut:
    try:
        return PredictionOrderOut.model_validate(prediction_fill(db, order_id))
    except KeyError:
        raise HTTPException(404, "order not found") from None
    except ValueError as e:
        raise HTTPException(409, str(e)) from e


@app.post("/api/v1/prediction/orders/{order_id}/cancel", response_model=PredictionOrderOut)
def cancel_prediction_order(order_id: str, db: Session = Depends(get_db)) -> PredictionOrderOut:
    try:
        return PredictionOrderOut.model_validate(prediction_cancel(db, order_id))
    except KeyError:
        raise HTTPException(404, "order not found") from None
    except ValueError as e:
        raise HTTPException(409, str(e)) from e


@app.post("/api/v1/prediction/markets/{market_id}/settle", response_model=PredictionMarketOut)
def settle_prediction_market(
    market_id: str, body: PredictionSettlementIn, db: Session = Depends(get_db)
) -> PredictionMarketOut:
    try:
        m = prediction_settle(db, market_id, body.result)
    except KeyError:
        raise HTTPException(404, "market not found") from None
    except ValueError as e:
        raise HTTPException(409, str(e)) from e
    return PredictionMarketOut(
        id=m.id,
        title=m.title,
        yes_price=m.yes_price,
        no_price=Decimal("1.00") - m.yes_price,
        status=m.status,
        result=m.result,
    )


@app.get("/api/v1/events/stream")
async def event_stream(
    request: Request, last_event_id: str | None = Header(None, alias="Last-Event-ID")
) -> StreamingResponse:
    try:
        cursor = min(2_147_483_647, max(0, int(last_event_id or "0")))
    except ValueError:
        cursor = 0

    async def gen() -> AsyncIterator[str]:
        nonlocal cursor
        for _ in range(30):
            if await request.is_disconnected():
                break
            with SessionLocal() as db:
                rows = stream_events(db, cursor)
            if rows:
                for event in rows:
                    payload = EventOut.model_validate(event).model_dump(mode="json")
                    cursor = event.id
                    yield format_sse("domain", payload, event.id)
            else:
                yield format_sse("heartbeat", {})
            await asyncio.sleep(1)

    return StreamingResponse(
        gen(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
