from pathlib import Path
from tempfile import TemporaryDirectory

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session, sessionmaker

from app import main
from app.db import get_db
from app.models import Base
from app.service import seed


def _test_engine():
    import os

    url = os.getenv("TEST_DATABASE_URL")
    if url:
        parsed = make_url(url)
        if (
            parsed.get_backend_name() != "postgresql"
            or parsed.host not in {"localhost", "127.0.0.1", "::1"}
            or not (parsed.database or "").endswith("_test")
        ):
            pytest.fail(
                "TEST_DATABASE_URL must be local PostgreSQL with a database ending in _test"
            )
        return create_engine(url, pool_pre_ping=True)
    return None


@pytest.fixture()
def db_factory():
    external = _test_engine()
    with TemporaryDirectory() as temp:
        engine = external or create_engine(
            f"sqlite:///{Path(temp) / 'test.db'}", connect_args={"check_same_thread": False}
        )
        Base.metadata.drop_all(engine)
        Base.metadata.create_all(engine)
        factory = sessionmaker(bind=engine, expire_on_commit=False)
        with factory() as db:
            seed(db)
        yield factory
        Base.metadata.drop_all(engine)
        engine.dispose()


@pytest.fixture()
def client(monkeypatch: pytest.MonkeyPatch, db_factory):
    monkeypatch.setattr(main, "SessionLocal", db_factory)

    def override():
        with db_factory() as db:
            yield db

    main.app.dependency_overrides[get_db] = override
    with TestClient(main.app) as test_client:
        yield test_client
    main.app.dependency_overrides.clear()


@pytest.fixture()
def db(db_factory) -> Session:
    with db_factory() as session:
        yield session
