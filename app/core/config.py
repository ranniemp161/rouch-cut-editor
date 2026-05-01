from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    # extra="ignore" so the shared .env can hold frontend vars (NEXT_PUBLIC_*) and
    # third-party keys (GEMINI_API_KEY) without forcing every consumer to declare
    # them here. Each module reads its own keys directly via os.getenv().
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    DATABASE_URL: str
    APP_ENV: str = "development"
    API_V1_PREFIX: str = "/api/v1"


settings = Settings()
