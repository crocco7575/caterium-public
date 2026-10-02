from alembic import command
from alembic.config import Config

from app.db import SessionLocal
from app.service import seed

cfg = Config("alembic.ini")
command.upgrade(cfg, "head")
with SessionLocal() as db:
    seed(db)
