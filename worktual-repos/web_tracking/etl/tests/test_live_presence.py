from ingest.live_presence import extract_live_fields, resolve_stored_page, update_from_collect_body


def test_extract_live_fields_page_view_path():
    body = {
        "websiteId": 1011,
        "visitorId": "visitor_abc",
        "sessionId": "session_xyz",
        "type": "events_v3",
        "events": [
            {"name": "click", "ts": 1_700_000_000_000},
            {
                "name": "page_view",
                "ts": 1_700_000_001_000,
                "properties": {"path": "/login?returnTo=/"},
            },
        ],
        "_geo": {"country": "IN"},
    }
    fields = extract_live_fields(body)
    assert fields is not None
    assert fields["website_id"] == 1011
    assert fields["visitor_id"] == "visitor_abc"
    assert fields["session_id"] == "session_xyz"
    assert fields["current_page"] == "/login?returnTo=/"
    assert fields["country"] == "IN"
    assert fields["last_activity_ms"] == 1_700_000_001_000


def test_extract_live_fields_string_website_id():
    body = {
        "websiteId": "1009",
        "visitorId": "visitor_abc",
        "sessionId": "session_xyz",
        "type": "events_v3",
        "events": [{"name": "page_view", "ts": 2, "properties": {"path": "/shop"}}],
    }
    fields = extract_live_fields(body)
    assert fields is not None
    assert fields["website_id"] == 1009
    assert fields["current_page"] == "/shop"


def test_extract_live_fields_heartbeat_does_not_use_landing_path():
    body = {
        "websiteId": 1011,
        "visitorId": "visitor_abc",
        "sessionId": "session_xyz",
        "type": "events_v3",
        "events": [{"name": "heartbeat", "ts": 3, "props": {"intervalMs": 30000}}],
        "profiles": {"session": {"id": "session_xyz", "landingPath": "/"}},
    }
    fields = extract_live_fields(body)
    assert fields is not None
    assert fields["current_page"] == ""


def test_extract_live_fields_heartbeat_does_not_change_page():
    body = {
        "websiteId": 1011,
        "visitorId": "visitor_abc",
        "sessionId": "session_xyz",
        "type": "events_v3",
        "events": [
            {
                "name": "page_view",
                "ts": 1_700_000_000_000,
                "properties": {"path": "/products/plain-sweatshirt-2"},
            },
            {"name": "heartbeat", "ts": 1_700_000_030_000, "props": {"path": "/cart"}},
        ],
        "profiles": {"session": {"landingPath": "/"}},
        "sentAt": 1_700_000_040_000,
    }
    fields = extract_live_fields(body)
    assert fields["current_page"] == "/products/plain-sweatshirt-2"
    assert fields["current_page_ts"] == 1_700_000_000_000
    assert fields["last_activity_ms"] == 1_700_000_040_000


def test_extract_live_fields_click_path_does_not_count_as_page():
    body = {
        "websiteId": 1011,
        "visitorId": "visitor_abc",
        "sessionId": "session_xyz",
        "type": "events_v3",
        "events": [{"name": "click", "ts": 4, "props": {"path": "/pricing"}}],
        "profiles": {"session": {"landingPath": "/"}},
    }
    fields = extract_live_fields(body)
    assert fields["current_page"] == ""
    assert fields["current_page_ts"] == 0


def test_extract_live_fields_missing_session_returns_none():
    body = {
        "websiteId": 1011,
        "visitorId": "visitor_abc",
        "type": "events_v3",
        "events": [{"name": "page_view", "ts": 1, "properties": {"path": "/"}}],
    }
    assert extract_live_fields(body) is None


def test_resolve_stored_page_stale_page_view_does_not_rewind():
    page, ts, changed = resolve_stored_page(
        "/products/plain-sweatshirt-2",
        1_700_000_030_000,
        "/",
        1_700_000_001_000,
    )
    assert page == "/products/plain-sweatshirt-2"
    assert ts == 1_700_000_030_000
    assert changed is False


def test_resolve_stored_page_heartbeat_without_page_keeps_existing():
    page, ts, changed = resolve_stored_page(
        "/products/plain-sweatshirt-2",
        1_700_000_000_000,
        "",
        0,
    )
    assert page == "/products/plain-sweatshirt-2"
    assert ts == 1_700_000_000_000
    assert changed is False


def test_resolve_stored_page_newer_page_view_applies():
    page, ts, changed = resolve_stored_page(
        "/products/plain-sweatshirt-2",
        1_700_000_000_000,
        "/products/floral-maxi",
        1_700_000_010_000,
    )
    assert page == "/products/floral-maxi"
    assert ts == 1_700_000_010_000
    assert changed is True


class _FakePipeline:
    def __init__(self, redis: "_FakeRedis") -> None:
        self.redis = redis
        self.ops: list[tuple] = []

    def hset(self, key, mapping=None):
        self.ops.append(("hset", key, mapping))
        return self

    def expire(self, key, ttl):
        self.ops.append(("expire", key, ttl))
        return self

    def zadd(self, key, mapping):
        self.ops.append(("zadd", key, mapping))
        return self

    def zremrangebyscore(self, key, mn, mx):
        self.ops.append(("zremrangebyscore", key, mn, mx))
        return self

    def zrem(self, key, member):
        self.ops.append(("zrem", key, member))
        return self

    def delete(self, *keys):
        self.ops.append(("delete", keys))
        return self

    def set(self, key, value, ex=None):
        self.ops.append(("set", key, value, ex))
        return self

    def publish(self, channel, message):
        self.ops.append(("publish", channel, message))
        return self

    def execute(self):
        results = [self.redis.run(op) for op in self.ops]
        self.ops.clear()
        return results


class _FakeRedis:
    def __init__(self) -> None:
        self.hashes: dict[str, dict[str, str]] = {}
        self.zsets: dict[str, dict[str, int]] = {}
        self.kv: dict[str, str] = {}
        self.published: list[tuple[str, str]] = []

    def hgetall(self, key):
        return dict(self.hashes.get(key, {}))

    def get(self, key):
        return self.kv.get(key)

    def pipeline(self, transaction=False):
        return _FakePipeline(self)

    def run(self, op):
        kind = op[0]
        if kind == "hset":
            _, key, mapping = op
            self.hashes.setdefault(key, {}).update(mapping or {})
        elif kind == "set":
            _, key, value, _ex = op
            self.kv[key] = value
        elif kind == "zadd":
            _, key, mapping = op
            self.zsets.setdefault(key, {}).update(mapping or {})
        elif kind == "zrem":
            _, key, member = op
            self.zsets.setdefault(key, {}).pop(member, None)
        elif kind == "delete":
            _, keys = op
            for key in keys:
                self.hashes.pop(key, None)
                self.kv.pop(key, None)
        elif kind == "publish":
            _, channel, message = op
            self.published.append((channel, message))
        return True


def _settings():
    from types import SimpleNamespace

    return SimpleNamespace(
        live_presence_enabled=True,
        redis_url="redis://fake",
        live_presence_ttl_seconds=300,
    )


def test_update_replaces_previous_session_for_same_visitor():
    fake = _FakeRedis()
    import ingest.live_presence as lp

    orig = lp._redis_client
    lp._redis_client = lambda _url: fake
    try:
        settings = _settings()
        body_a = {
            "websiteId": 1011,
            "visitorId": "visitor_abc",
            "sessionId": "session_old",
            "type": "events_v3",
            "events": [{"name": "page_view", "ts": 1_700_000_000_000, "properties": {"path": "/"}}],
        }
        update_from_collect_body(body_a, settings=settings)
        body_b = {
            "websiteId": 1011,
            "visitorId": "visitor_abc",
            "sessionId": "session_new",
            "type": "events_v3",
            "events": [{"name": "page_view", "ts": 1_700_000_010_000, "properties": {"path": "/bag"}}],
        }
        update_from_collect_body(body_b, settings=settings)
        assert "session_old" not in fake.zsets.get("wt:live:1011:sessions", {})
        assert "session_new" in fake.zsets.get("wt:live:1011:sessions", {})
        assert "wt:live:1011:session:session_old" not in fake.hashes
        assert fake.kv["wt:live:1011:visitor:visitor_abc"] == "session_new"
    finally:
        lp._redis_client = orig


def test_update_ignores_stale_event_from_replaced_session():
    fake = _FakeRedis()
    import ingest.live_presence as lp

    orig = lp._redis_client
    lp._redis_client = lambda _url: fake
    try:
        settings = _settings()
        update_from_collect_body(
            {
                "websiteId": 1011,
                "visitorId": "visitor_abc",
                "sessionId": "session_old",
                "type": "events_v3",
                "events": [{"name": "page_view", "ts": 1_700_000_000_000, "properties": {"path": "/"}}],
            },
            settings=settings,
        )
        update_from_collect_body(
            {
                "websiteId": 1011,
                "visitorId": "visitor_abc",
                "sessionId": "session_new",
                "type": "events_v3",
                "events": [{"name": "page_view", "ts": 1_700_000_010_000, "properties": {"path": "/bag"}}],
            },
            settings=settings,
        )
        update_from_collect_body(
            {
                "websiteId": 1011,
                "visitorId": "visitor_abc",
                "sessionId": "session_old",
                "type": "events_v3",
                "events": [{"name": "page_view", "ts": 1_700_000_001_000, "properties": {"path": "/products/powered-blue-maxi"}}],
            },
            settings=settings,
        )
        assert fake.kv["wt:live:1011:visitor:visitor_abc"] == "session_new"
        assert "session_old" not in fake.zsets.get("wt:live:1011:sessions", {})
        assert fake.hashes["wt:live:1011:session:session_new"]["current_page"] == "/bag"
    finally:
        lp._redis_client = orig


def test_update_stale_page_view_does_not_publish_rewind():
    fake = _FakeRedis()
    import ingest.live_presence as lp

    orig = lp._redis_client
    lp._redis_client = lambda _url: fake
    try:
        settings = _settings()
        update_from_collect_body(
            {
                "websiteId": 1011,
                "visitorId": "visitor_abc",
                "sessionId": "session_xyz",
                "type": "events_v3",
                "events": [{
                    "name": "page_view",
                    "ts": 1_700_000_030_000,
                    "properties": {"path": "/products/plain-sweatshirt-2"},
                }],
            },
            settings=settings,
        )
        fake.published.clear()
        update_from_collect_body(
            {
                "websiteId": 1011,
                "visitorId": "visitor_abc",
                "sessionId": "session_xyz",
                "type": "events_v3",
                "events": [{
                    "name": "page_view",
                    "ts": 1_700_000_001_000,
                    "properties": {"path": "/"},
                }],
            },
            settings=settings,
        )
        hash_row = fake.hashes["wt:live:1011:session:session_xyz"]
        assert hash_row["current_page"] == "/products/plain-sweatshirt-2"
        assert fake.published == []
    finally:
        lp._redis_client = orig

