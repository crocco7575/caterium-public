"""Only fictional instruments are supported; no network or broker credentials."""

from dataclasses import dataclass
from decimal import Decimal
from typing import Protocol

PRICES = {"DEMO": Decimal("100.00"), "SAMPLE": Decimal("25.00")}


@dataclass(frozen=True)
class MockExecution:
    price: Decimal
    quantity: int


class Broker(Protocol):
    def quote(self, symbol: str) -> Decimal: ...

    def fill(self, symbol: str, quantity: int) -> MockExecution: ...


class MockBroker:
    def quote(self, symbol: str) -> Decimal:
        if symbol not in PRICES:
            raise ValueError("unsupported synthetic symbol")
        return PRICES[symbol]

    def fill(self, symbol: str, quantity: int) -> MockExecution:
        """A deterministic lifecycle fixture, not a fill-realism model."""
        if quantity < 1:
            raise ValueError("quantity must be positive")
        return MockExecution(self.quote(symbol), quantity)
