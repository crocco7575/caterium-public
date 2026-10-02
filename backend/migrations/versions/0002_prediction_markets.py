"""add isolated synthetic prediction market tables"""

import sqlalchemy as sa
from alembic import op

revision = "0002_prediction_markets"
down_revision = "0001_initial"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "prediction_markets",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column("title", sa.String(255), nullable=False),
        sa.Column("yes_price", sa.Numeric(20, 2), nullable=False),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("result", sa.String(3)),
    )
    op.create_table(
        "prediction_orders",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column("idempotency_key", sa.String(128), nullable=False, unique=True),
        sa.Column("payload_hash", sa.String(64), nullable=False),
        sa.Column(
            "market_id", sa.String(64), sa.ForeignKey("prediction_markets.id"), nullable=False
        ),
        sa.Column("outcome", sa.String(3), nullable=False),
        sa.Column("quantity", sa.Integer, nullable=False),
        sa.Column("price", sa.Numeric(20, 2), nullable=False),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("rejection_reason", sa.String(255)),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "quantity > 0 AND quantity <= 1000000", name="prediction_quantity_valid"
        ),
        sa.CheckConstraint("outcome IN ('YES', 'NO')", name="prediction_outcome_valid"),
        sa.CheckConstraint(
            "status IN ('SUBMITTED', 'FILLED', 'CANCELLED', 'REJECTED')",
            name="prediction_status_valid",
        ),
    )
    op.create_table(
        "prediction_positions",
        sa.Column(
            "market_id", sa.String(64), sa.ForeignKey("prediction_markets.id"), primary_key=True
        ),
        sa.Column("outcome", sa.String(3), primary_key=True),
        sa.Column("quantity", sa.Integer, nullable=False, server_default="0"),
        sa.Column("cost_basis", sa.Numeric(20, 2), nullable=False, server_default="0"),
        sa.Column("settled", sa.Boolean, nullable=False, server_default=sa.false()),
        sa.Column("payout", sa.Numeric(20, 2), nullable=False, server_default="0"),
        sa.CheckConstraint("quantity >= 0", name="prediction_position_nonnegative"),
    )
    op.create_table(
        "prediction_fills",
        sa.Column(
            "order_id", sa.String(64), sa.ForeignKey("prediction_orders.id"), primary_key=True
        ),
        sa.Column("quantity", sa.Integer, nullable=False),
        sa.Column("price", sa.Numeric(20, 2), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_table(
        "prediction_events",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("type", sa.String(32), nullable=False),
        sa.Column("order_id", sa.String(64), sa.ForeignKey("prediction_orders.id")),
        sa.Column("market_id", sa.String(64), sa.ForeignKey("prediction_markets.id")),
        sa.Column("message", sa.String(255), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )


def downgrade() -> None:
    for table in (
        "prediction_events",
        "prediction_fills",
        "prediction_positions",
        "prediction_orders",
        "prediction_markets",
    ):
        op.drop_table(table)
