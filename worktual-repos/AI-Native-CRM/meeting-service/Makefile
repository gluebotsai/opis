.PHONY: test up down token

test:
	.venv/bin/python -m pytest -q

up:
	docker compose up --build -d

down:
	docker compose down

token:
	.venv/bin/python scripts/mint_token.py --org 1003
