from logging.config import fileConfig

from sqlalchemy import engine_from_config, pool
from sqlmodel import SQLModel

from alembic import context

# ---------------------------------------------------------------------------
# 1. Pull DATABASE_URL from the app's settings — single source of truth.
# ---------------------------------------------------------------------------
from app.core.config import settings

# ---------------------------------------------------------------------------
# 2. Import every model so their tables are registered on SQLModel.metadata
#    before autogenerate inspects it. The order in app.models.__init__ already
#    guarantees parent-before-child FK resolution.
# ---------------------------------------------------------------------------
import app.models  # noqa: F401

# ---------------------------------------------------------------------------
# 3. Point Alembic at SQLModel's shared metadata object.
#    This is the fix: without this line, autogenerate sees an empty registry.
# ---------------------------------------------------------------------------
target_metadata = SQLModel.metadata

# Alembic Config object — gives access to values in alembic.ini.
config = context.config

# Override the (intentionally blank) sqlalchemy.url in alembic.ini with the
# value from our environment so credentials never live in a config file.
config.set_main_option("sqlalchemy.url", settings.DATABASE_URL)

if config.config_file_name is not None:
    fileConfig(config.config_file_name)


def run_migrations_offline() -> None:
    """
    Emit SQL to stdout without a live DB connection.
    Useful for generating migration scripts to review before applying.
    """
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        # Emit explicit 'CREATE INDEX' statements for SQLModel indexes.
        render_as_batch=False,
    )

    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    """
    Run migrations against a live connection.
    NullPool is used because Neon is serverless — the proxy manages pooling
    on its side and long-lived app pools accumulate stale sockets.
    """
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
        connect_args={"sslmode": "require"},
    )

    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
        )

        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
