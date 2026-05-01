from contextlib import asynccontextmanager

from fastapi import FastAPI
from sqlmodel import SQLModel

import app.models  # noqa: F401 — registers all SQLModel table metadata before create_all
from app.api import exports, media, media_assets, projects, transcripts
from app.core.config import settings
from app.db.session import engine


@asynccontextmanager
async def lifespan(_: FastAPI):
    # Schema is managed by Alembic migrations — do not call create_all here.
    yield


app = FastAPI(
    title="Rough-Cut Editor API",
    version="0.1.0",
    lifespan=lifespan,
)

app.include_router(projects.router, prefix=settings.API_V1_PREFIX)
app.include_router(media.router, prefix=settings.API_V1_PREFIX)
app.include_router(media_assets.router, prefix=settings.API_V1_PREFIX)
app.include_router(transcripts.router, prefix=settings.API_V1_PREFIX)
app.include_router(exports.router, prefix=settings.API_V1_PREFIX)


@app.get("/health", tags=["health"])
def health_check() -> dict[str, str]:
    return {"status": "ok"}
