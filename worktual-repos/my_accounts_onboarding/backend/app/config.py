from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = (
        "postgresql+psycopg://worktual:worktual_secret_change_me@localhost:5432/worktual_accounts"
    )
    app_env: str = "development"
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"


settings = Settings()
