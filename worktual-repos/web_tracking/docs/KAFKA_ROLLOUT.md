# Kafka ingest rollout

By default ingest writes directly to ClickHouse (`INGEST_WRITE_MODE=direct`). To buffer through Kafka:

| Mode | Behavior |
|------|----------|
| `direct` | API → ClickHouse only (local dev default) |
| `kafka` | API → Kafka topic; Python consumer → ClickHouse |
| `dual` | Publish to Kafka **and** insert ClickHouse (QA verification) |

Configure in `.env` (see `.env.example`):

```env
INGEST_WRITE_MODE=direct
KAFKA_BOOTSTRAP_SERVERS=82.113.92.45:9092
KAFKA_TOPIC=cdp.ingestion.webtracking
KAFKA_CLIENT_ID=webtracking-ingest
KAFKA_CONSUMER_GROUP=webtracking-ch-writer
```

Each Kafka message is `{ "payload": <enriched tracking body>, "published_at": "<ISO8601 UTC>" }`. The consumer sets ClickHouse `received_at` from `published_at`.

**Rollout:** QA with `dual`, then switch to `kafka`. Run the consumer alongside ingest:

```bash
python etl/run_kafka_consumer.py
# or: python run_backend.py (starts consumer when INGEST_WRITE_MODE=kafka|dual)
```

On Kafka publish failure the ingest API returns **503**.

**Verify end-to-end:**

```bash
python scripts/verify_kafka_ingest_pipeline.py --consume-one --organization-id 1
python scripts/verify_kafka_ingest_pipeline.py --via-api
cd etl && pytest tests/test_kafka_envelope.py tests/test_replay_validation.py -v
```
