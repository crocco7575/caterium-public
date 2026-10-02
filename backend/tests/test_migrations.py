from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, text

from app.settings import settings


def _config(url: str, monkeypatch) -> Config:
    cfg = Config(str(Path(__file__).parents[1] / "alembic.ini"))
    cfg.set_main_option("sqlalchemy.url", url)
    monkeypatch.setattr(settings, "database_url", url)
    return cfg


def test_upgrade_preserves_equity_data_and_downgrade_reupgrade(tmp_path, monkeypatch):
    url = f"sqlite:///{tmp_path / 'migration.db'}"
    cfg = _config(url, monkeypatch)
    command.upgrade(cfg, "0001_initial")
    engine = create_engine(url)
    with engine.begin() as conn:
        conn.execute(
            text(
                "INSERT INTO accounts (id,cash,reserved_cash,currency) "
                "VALUES ('legacy',123.45,0,'USD')"
            )
        )
    command.upgrade(cfg, "head")
    with engine.connect() as conn:
        assert conn.execute(text("SELECT cash FROM accounts WHERE id='legacy'")).scalar() == 123.45
        assert conn.execute(text("SELECT COUNT(*) FROM prediction_markets")).scalar() == 0
    command.downgrade(cfg, "0001_initial")
    command.upgrade(cfg, "head")
    with engine.connect() as conn:
        assert conn.execute(text("SELECT cash FROM accounts WHERE id='legacy'")).scalar() == 123.45
        assert conn.execute(text("SELECT COUNT(*) FROM prediction_orders")).scalar() == 0


def test_alembic_check_is_clean_after_upgrade(tmp_path, monkeypatch):
    url = f"sqlite:///{tmp_path / 'check.db'}"
    cfg = _config(url, monkeypatch)
    command.upgrade(cfg, "head")
    command.check(cfg)
