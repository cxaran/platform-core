from redis import Redis

from backend.app.core.settings import settings

RedisText = str | bytes | bytearray | memoryview


def redis_text(value: RedisText) -> str:
    if isinstance(value, str):
        return value
    return bytes(value).decode("utf-8")


redis_client = Redis(
    host=settings.redis_host, port=settings.redis_port, db=settings.redis_db
)
