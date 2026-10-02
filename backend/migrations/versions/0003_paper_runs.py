"""add bounded synthetic paper strategy runs"""

import sqlalchemy as sa
from alembic import op

revision = "0003_paper_runs"
down_revision = "0002_prediction_markets"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "paper_runs",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column("idempotency_key", sa.String(128), nullable=False, unique=True),
        sa.Column("payload_hash", sa.String(64), nullable=False),
        sa.Column("strategy_id", sa.String(32), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("payload", sa.Text, nullable=False),
    )
    op.create_index("ix_paper_runs_created_at", "paper_runs", ["created_at"])


def downgrade() -> None:
    op.drop_index("ix_paper_runs_created_at", table_name="paper_runs")
    op.drop_table("paper_runs")
