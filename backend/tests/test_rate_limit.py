import os
import unittest
from types import SimpleNamespace
from unittest.mock import patch

os.environ.update(
    {
        "ENVIRONMENT": "local",
        "SECRET_KEY": "test-secret-key",
        "ACCESS_TOKEN_EXPIRE_MINUTES": "30",
        "EMAIL_TOKEN_EXPIRE_MINUTES": "30",
        "TRYS_BEFORE_LOCK": "5",
        "REDIS_HOST": "redis",
        "REDIS_PORT": "6379",
        "REDIS_DB": "0",
        "SMTP_HOST": "mailpit",
        "SMTP_PORT": "1025",
        "SMTP_USER": "test@example.com",
        "SMTP_PASSWORD": "test-password",
        "SMTP_FROM_EMAIL": "test@example.com",
        "SMTP_FROM_NAME": "Platform Core Test",
        "SMTP_TLS": "false",
        "SMTP_SSL": "false",
        "SMTP_USE_CREDENTIALS": "false",
        "POSTGRES_USER": "platform",
        "POSTGRES_PASSWORD": "platform",
        "POSTGRES_SERVER": "postgres",
        "POSTGRES_PORT": "5432",
        "POSTGRES_DB": "platform_core",
    }
)

from fastapi.testclient import TestClient  # noqa: E402
from redis.exceptions import RedisError  # noqa: E402
from sqlalchemy import create_engine  # noqa: E402
from sqlalchemy.pool import StaticPool  # noqa: E402
from sqlmodel import Session  # noqa: E402

from backend.app.core.database import get_db  # noqa: E402
from backend.app.core.settings import settings  # noqa: E402
from backend.app.main import app  # noqa: E402
from backend.app.models import Base  # noqa: E402
from backend.app.security import rate_limit  # noqa: E402
from backend.app.security.rate_limit import (  # noqa: E402
    BucketPolicy,
    RateLimiter,
    RateLimitUnavailable,
    normalize_identity,
    parse_policy,
    resolve_client_ip,
)


class FakeRedis:
    """Redis en memoria con reloj manual que emula INCR + PEXPIRE-al-crear + PTTL."""

    def __init__(self) -> None:
        self.counts: dict[str, int] = {}
        self.expiry_ms: dict[str, int] = {}
        self.now_ms = 0
        self.fail = False

    def advance(self, ms: int) -> None:
        self.now_ms += ms

    def register_script(self, script: str):
        def run(*, keys, args):
            if self.fail:
                raise RedisError("redis down")
            key = keys[0]
            ttl_arg = int(args[0])
            expiry = self.expiry_ms.get(key)
            if expiry is not None and self.now_ms >= expiry:
                self.counts.pop(key, None)
                self.expiry_ms.pop(key, None)
            count = self.counts.get(key, 0) + 1
            self.counts[key] = count
            if count == 1:
                self.expiry_ms[key] = self.now_ms + ttl_arg
            ttl = self.expiry_ms.get(key, self.now_ms) - self.now_ms
            return [count, ttl]

        return run


def _limiter(fake: FakeRedis, *, fail_open: bool = False) -> RateLimiter:
    return RateLimiter(fake, secret="secret", fail_open=fail_open)


class RateLimitServiceTest(unittest.TestCase):
    def test_parse_policy(self) -> None:
        self.assertEqual(parse_policy("10/900"), BucketPolicy(10, 900))
        with self.assertRaises(ValueError):
            parse_policy("nope")
        with self.assertRaises(ValueError):
            parse_policy("0/900")

    def test_key_has_no_plaintext_identifier(self) -> None:
        limiter = _limiter(FakeRedis())
        key = limiter.key("login_identity", "User@Example.com", 900)
        self.assertNotIn("User@Example.com", key)
        self.assertNotIn("user@example.com", key)
        self.assertIn("login_identity", key)

    def test_allows_up_to_limit_then_blocks(self) -> None:
        limiter = _limiter(FakeRedis())
        first = limiter.check("b", "id", limit=2, window_seconds=900)
        second = limiter.check("b", "id", limit=2, window_seconds=900)
        third = limiter.check("b", "id", limit=2, window_seconds=900)
        self.assertTrue(first.allowed)
        self.assertTrue(second.allowed)
        self.assertFalse(third.allowed)
        self.assertEqual(third.retry_after, 900)

    def test_window_expiry_resets_counter(self) -> None:
        fake = FakeRedis()
        limiter = _limiter(fake)
        limiter.check("b", "id", limit=1, window_seconds=900)
        self.assertFalse(limiter.check("b", "id", limit=1, window_seconds=900).allowed)
        fake.advance(900_000 + 1)
        self.assertTrue(limiter.check("b", "id", limit=1, window_seconds=900).allowed)

    def test_fail_closed_when_redis_down(self) -> None:
        fake = FakeRedis()
        fake.fail = True
        limiter = _limiter(fake)
        with self.assertRaises(RateLimitUnavailable):
            limiter.check("b", "id", limit=1, window_seconds=900)

    def test_fail_open_when_configured(self) -> None:
        fake = FakeRedis()
        fake.fail = True
        limiter = _limiter(fake, fail_open=True)
        self.assertTrue(limiter.check("b", "id", limit=1, window_seconds=900).allowed)

    def test_normalize_identity(self) -> None:
        self.assertEqual(normalize_identity("  User@Example.COM "), "user@example.com")

    def test_resolve_ip_ignores_headers_from_untrusted_peer(self) -> None:
        request = SimpleNamespace(
            client=SimpleNamespace(host="203.0.113.9"),
            headers={"x-real-ip": "1.2.3.4", "x-forwarded-for": "9.9.9.9"},
        )
        self.assertEqual(resolve_client_ip(request, frozenset()), "203.0.113.9")

    def test_resolve_ip_trusts_proxy_real_ip(self) -> None:
        request = SimpleNamespace(
            client=SimpleNamespace(host="10.0.0.1"),
            headers={"x-real-ip": "1.2.3.4", "x-forwarded-for": "9.9.9.9, 1.2.3.4"},
        )
        self.assertEqual(resolve_client_ip(request, frozenset({"10.0.0.1"})), "1.2.3.4")


def _bootstrap_payload() -> dict:
    return {
        "user": {
            "name": "Admin",
            "last_name": "Platform",
            "email": "admin@example.com",
            "password": "admin-password-123",
            "confirm_password": "admin-password-123",
        },
        "system_admin_role": {"label": "Administrador de plataforma"},
        "additional_roles": [],
    }


class RateLimitRouteTest(unittest.TestCase):
    def setUp(self) -> None:
        self.engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(self.engine)

        def override_db():
            with Session(self.engine) as session:
                yield session

        app.dependency_overrides[get_db] = override_db
        self.client = TestClient(app)

        self.fake = FakeRedis()
        self.limiter = _limiter(self.fake)
        self._prev_enabled = settings.rate_limit_enabled
        settings.rate_limit_enabled = True
        self._patches = [
            patch.object(rate_limit, "get_rate_limiter", lambda: self.limiter),
            patch.object(
                rate_limit,
                "_policies",
                lambda: {"bootstrap_ip": BucketPolicy(limit=2, window_seconds=900)},
            ),
        ]
        for item in self._patches:
            item.start()

    def tearDown(self) -> None:
        for item in self._patches:
            item.stop()
        settings.rate_limit_enabled = self._prev_enabled
        app.dependency_overrides.clear()

    def test_initialize_blocks_after_threshold(self) -> None:
        payload = _bootstrap_payload()
        statuses = [self.client.post("/api/v1/bootstrap/initialize", json=payload).status_code for _ in range(2)]
        blocked = self.client.post("/api/v1/bootstrap/initialize", json=payload)

        # Las dos primeras pasan el limiter (201 y luego 409 por bootstrap cerrado).
        self.assertEqual(statuses, [201, 409])
        self.assertEqual(blocked.status_code, 429)
        body = blocked.json()
        self.assertEqual(body["code"], "rate_limited")
        self.assertIn("retry-after", {key.lower() for key in blocked.headers})
        # No revela qué bucket bloqueó.
        self.assertNotIn("bootstrap", body["message"].lower())
        self.assertNotIn("ip", body["message"].lower())


if __name__ == "__main__":
    unittest.main()
