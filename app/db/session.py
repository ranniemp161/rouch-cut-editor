from typing import Generator

from sqlalchemy.pool import NullPool
from sqlmodel import Session, create_engine

from app.core.config import settings

# Neon is serverless — their proxy manages pooling on its side.
# NullPool prevents the app from holding idle connections across Neon's compute
# scale-to-zero windows, which cause stale socket errors.
engine = create_engine(
    settings.DATABASE_URL,
    echo=settings.APP_ENV == "development",
    poolclass=NullPool,
    pool_pre_ping=True,
    connect_args={"sslmode": "require"},
)


def get_session() -> Generator[Session, None, None]:
    with Session(engine) as session:
        yield session
