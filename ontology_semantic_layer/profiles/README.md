# dbt profiles

`profiles.yml` is **auto-generated** by `scripts/dbt_parse_all.py` from `.env` (`pg_host`, `pg_user`, etc.).

Do not commit `profiles.yml` — it contains database credentials. It is listed in `.gitignore`.
