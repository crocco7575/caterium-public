from datetime import UTC, datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, StrictInt, field_validator


class AccountOut(BaseModel):
    id: str
    cash: Decimal
    reserved_cash: Decimal
    available_cash: Decimal
    equity: Decimal
    currency: str


class PositionOut(BaseModel):
    symbol: str
    quantity: int
    reserved_quantity: int
    average_price: Decimal
    market_price: Decimal
    market_value: Decimal


class OrderIn(BaseModel):
    symbol: Literal["DEMO", "SAMPLE"]
    side: Literal["BUY", "SELL"]
    quantity: StrictInt = Field(gt=0, le=1_000_000)


class OrderOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    symbol: str
    side: str
    quantity: int
    price: Decimal
    status: str
    rejection_reason: str | None
    created_at: datetime
    updated_at: datetime

    @field_validator("created_at", "updated_at", mode="before")
    @classmethod
    def utc_timestamp(cls, value: datetime) -> datetime:
        # SQLite loses timezone metadata; the application always writes UTC.
        return value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)


class EventOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    type: str
    order_id: str | None
    message: str
    created_at: datetime

    @field_validator("created_at", mode="before")
    @classmethod
    def utc_timestamp(cls, value: datetime) -> datetime:
        if value.tzinfo is None:
            return value.replace(tzinfo=UTC)
        return value.astimezone(UTC)


class StrategyOut(BaseModel):
    id: str
    name: str
    status: str
    description: str


class DashboardOut(BaseModel):
    demo: bool
    account: AccountOut
    positions: list[PositionOut]
    orders: list[OrderOut]
    events: list[EventOut]
    strategy: StrategyOut
