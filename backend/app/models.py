from datetime import datetime
from decimal import Decimal

from sqlalchemy import Boolean, CheckConstraint, DateTime, ForeignKey, Integer, Numeric, String
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


class Account(Base):
    __tablename__ = "accounts"
    __table_args__ = (
        CheckConstraint("cash >= 0", name="cash_nonnegative"),
        CheckConstraint(
            "reserved_cash >= 0 AND reserved_cash <= cash", name="cash_reservation_valid"
        ),
    )
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    cash: Mapped[Decimal] = mapped_column(Numeric(20, 2))
    reserved_cash: Mapped[Decimal] = mapped_column(Numeric(20, 2), default=Decimal("0"))
    currency: Mapped[str] = mapped_column(String(3), default="USD")


class Position(Base):
    __tablename__ = "positions"
    __table_args__ = (
        CheckConstraint("quantity >= 0", name="position_nonnegative"),
        CheckConstraint(
            "reserved_quantity >= 0 AND reserved_quantity <= quantity",
            name="inventory_reservation_valid",
        ),
        CheckConstraint("average_price >= 0", name="basis_nonnegative"),
    )
    symbol: Mapped[str] = mapped_column(String(16), primary_key=True)
    quantity: Mapped[int] = mapped_column(Integer, default=0)
    reserved_quantity: Mapped[int] = mapped_column(Integer, default=0)
    average_price: Mapped[Decimal] = mapped_column(Numeric(20, 2), default=Decimal("0"))


class Order(Base):
    __tablename__ = "orders"
    __table_args__ = (
        CheckConstraint("quantity > 0 AND quantity <= 1000000", name="order_quantity_valid"),
        CheckConstraint("price > 0", name="order_price_positive"),
        CheckConstraint("side IN ('BUY', 'SELL')", name="order_side_valid"),
        CheckConstraint(
            "status IN ('SUBMITTED', 'FILLED', 'CANCELLED', 'REJECTED')", name="order_status_valid"
        ),
    )
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    idempotency_key: Mapped[str] = mapped_column(String(128), unique=True)
    payload_hash: Mapped[str] = mapped_column(String(64))
    symbol: Mapped[str] = mapped_column(String(16))
    side: Mapped[str] = mapped_column(String(4))
    quantity: Mapped[int] = mapped_column(Integer)
    price: Mapped[Decimal] = mapped_column(Numeric(20, 2))
    status: Mapped[str] = mapped_column(String(16))
    rejection_reason: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class Event(Base):
    __tablename__ = "events"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    type: Mapped[str] = mapped_column(String(32))
    order_id: Mapped[str | None] = mapped_column(ForeignKey("orders.id"), nullable=True)
    message: Mapped[str] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class Fill(Base):
    """Exactly one full synthetic fill per order in this deliberately narrow demo."""

    __tablename__ = "fills"
    __table_args__ = (
        CheckConstraint("quantity > 0", name="fill_quantity_positive"),
        CheckConstraint("price > 0", name="fill_price_positive"),
    )
    order_id: Mapped[str] = mapped_column(ForeignKey("orders.id"), primary_key=True)
    quantity: Mapped[int] = mapped_column(Integer)
    price: Mapped[Decimal] = mapped_column(Numeric(20, 2))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class PredictionMarket(Base):
    __tablename__ = "prediction_markets"
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    yes_price: Mapped[Decimal] = mapped_column(Numeric(20, 2), nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="OPEN")
    result: Mapped[str | None] = mapped_column(String(3), nullable=True)


class PredictionOrder(Base):
    __tablename__ = "prediction_orders"
    __table_args__ = (
        CheckConstraint("quantity > 0 AND quantity <= 1000000", name="prediction_quantity_valid"),
        CheckConstraint("outcome IN ('YES', 'NO')", name="prediction_outcome_valid"),
        CheckConstraint(
            "status IN ('SUBMITTED', 'FILLED', 'CANCELLED', 'REJECTED')",
            name="prediction_status_valid",
        ),
    )
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    idempotency_key: Mapped[str] = mapped_column(String(128), unique=True, nullable=False)
    payload_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    market_id: Mapped[str] = mapped_column(ForeignKey("prediction_markets.id"), nullable=False)
    outcome: Mapped[str] = mapped_column(String(3), nullable=False)
    quantity: Mapped[int] = mapped_column(Integer, nullable=False)
    price: Mapped[Decimal] = mapped_column(Numeric(20, 2), nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False)
    rejection_reason: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class PredictionPosition(Base):
    __tablename__ = "prediction_positions"
    __table_args__ = (CheckConstraint("quantity >= 0", name="prediction_position_nonnegative"),)
    market_id: Mapped[str] = mapped_column(ForeignKey("prediction_markets.id"), primary_key=True)
    outcome: Mapped[str] = mapped_column(String(3), primary_key=True)
    quantity: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    cost_basis: Mapped[Decimal] = mapped_column(
        Numeric(20, 2), nullable=False, default=Decimal("0")
    )
    settled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    payout: Mapped[Decimal] = mapped_column(Numeric(20, 2), nullable=False, default=Decimal("0"))


class PredictionFill(Base):
    __tablename__ = "prediction_fills"
    order_id: Mapped[str] = mapped_column(ForeignKey("prediction_orders.id"), primary_key=True)
    quantity: Mapped[int] = mapped_column(Integer, nullable=False)
    price: Mapped[Decimal] = mapped_column(Numeric(20, 2), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class PredictionEvent(Base):
    __tablename__ = "prediction_events"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    type: Mapped[str] = mapped_column(String(32), nullable=False)
    order_id: Mapped[str | None] = mapped_column(ForeignKey("prediction_orders.id"), nullable=True)
    market_id: Mapped[str | None] = mapped_column(
        ForeignKey("prediction_markets.id"), nullable=True
    )
    message: Mapped[str] = mapped_column(String(255), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
