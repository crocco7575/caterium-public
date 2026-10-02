from typing import Protocol

from app.schemas import OrderIn, StrategyOut


class Strategy(Protocol):
    descriptor: StrategyOut

    def propose(self) -> OrderIn: ...


class ExampleStrategy:
    descriptor = StrategyOut(
        id="example",
        name="ExampleStrategy",
        status="DEMO_ONLY",
        description="A fixed DEMO BUY proposal for lifecycle demonstration; not a trading signal.",
    )

    def propose(self) -> OrderIn:
        return OrderIn(symbol="DEMO", side="BUY", quantity=1)
