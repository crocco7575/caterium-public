"""initial synthetic demo schema"""

import sqlalchemy as sa
from alembic import op

revision = "0001_initial"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "accounts",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column("cash", sa.Numeric(20, 2), nullable=False),
        sa.Column("reserved_cash", sa.Numeric(20, 2), nullable=False, server_default="0"),
        sa.Column("currency", sa.String(3), nullable=False),
        sa.CheckConstraint("cash >= 0", name="cash_nonnegative"),
        sa.CheckConstraint(
            "reserved_cash >= 0 AND reserved_cash <= cash", name="cash_reservation_valid"
        ),
    )
    op.create_table(
        "positions",
        sa.Column("symbol", sa.String(16), primary_key=True),
        sa.Column("quantity", sa.Integer, nullable=False, server_default="0"),
        sa.Column("reserved_quantity", sa.Integer, nullable=False, server_default="0"),
        sa.Column("average_price", sa.Numeric(20, 2), nullable=False, server_default="0"),
        sa.CheckConstraint("quantity >= 0", name="position_nonnegative"),
        sa.CheckConstraint(
            "reserved_quantity >= 0 AND reserved_quantity <= quantity",
            name="inventory_reservation_valid",
        ),
        sa.CheckConstraint("average_price >= 0", name="basis_nonnegative"),
    )
    op.create_table(
        "orders",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column("idempotency_key", sa.String(128), nullable=False, unique=True),
        sa.Column("payload_hash", sa.String(64), nullable=False),
        sa.Column("symbol", sa.String(16), nullable=False),
        sa.Column("side", sa.String(4), nullable=False),
        sa.Column("quantity", sa.Integer, nullable=False),
        sa.Column("price", sa.Numeric(20, 2), nullable=False),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("rejection_reason", sa.String(255)),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("quantity > 0 AND quantity <= 1000000", name="order_quantity_valid"),
        sa.CheckConstraint("price > 0", name="order_price_positive"),
        sa.CheckConstraint("side IN ('BUY', 'SELL')", name="order_side_valid"),
        sa.CheckConstraint(
            "status IN ('SUBMITTED', 'FILLED', 'CANCELLED', 'REJECTED')", name="order_status_valid"
        ),
    )
    op.create_index("ix_orders_created_at", "orders", ["created_at"])
    op.create_table(
        "events",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("type", sa.String(32), nullable=False),
        sa.Column("order_id", sa.String(64), sa.ForeignKey("orders.id")),
        sa.Column("message", sa.String(255), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_table(
        "fills",
        sa.Column("order_id", sa.String(64), sa.ForeignKey("orders.id"), primary_key=True),
        sa.Column("quantity", sa.Integer, nullable=False),
        sa.Column("price", sa.Numeric(20, 2), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("quantity > 0", name="fill_quantity_positive"),
        sa.CheckConstraint("price > 0", name="fill_price_positive"),
    )


def downgrade() -> None:
    for table in ("fills", "events", "orders", "positions", "accounts"):
        op.drop_table(table)
