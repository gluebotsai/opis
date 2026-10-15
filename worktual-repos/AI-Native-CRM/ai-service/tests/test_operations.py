from app.operations import CircuitBreaker, Metrics, RateLimiter, redact_labels


def test_metric_labels_redact_secrets_and_pii() -> None:
    labels = redact_labels(
        {
            "agent": "crm-agent",
            "authorization": "Bearer secret",
            "customerEmail": "person@example.com",
            "prompt": "private prompt",
        }
    )
    assert labels["agent"] == "crm-agent"
    assert labels["authorization"] == "[redacted]"
    assert labels["customerEmail"] == "[redacted]"
    assert labels["prompt"] == "[redacted]"

    metrics = Metrics()
    metrics.increment("requests", authorization="secret", agent="crm-agent")
    row = metrics.snapshot()["counters"][0]
    assert row["labels"]["authorization"] == "[redacted]"


def test_rate_limiter_is_key_scoped() -> None:
    limiter = RateLimiter(2, window_seconds=60)
    assert limiter.allow("tenant-a", now=1)
    assert limiter.allow("tenant-a", now=2)
    assert not limiter.allow("tenant-a", now=3)
    assert limiter.allow("tenant-b", now=3)
    assert limiter.allow("tenant-a", now=62)


def test_circuit_breaker_opens_and_recovers() -> None:
    breaker = CircuitBreaker(failure_threshold=2, recovery_seconds=10)
    breaker.failure(now=1)
    assert breaker.allow(now=2)
    breaker.failure(now=2)
    assert not breaker.allow(now=3)
    assert breaker.allow(now=12)
    breaker.success()
    assert breaker.state == "closed"
