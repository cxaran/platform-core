"""Límites de día de calendario para filtros de fecha sobre columnas ``datetime``.

Las columnas ``datetime`` del modelo son *naive* y representan instantes UTC. Un
filtro de fecha de C1 (``on/before/after/between``) recibe un ``date``
(``YYYY-MM-DD``) que el usuario interpreta en la **zona horaria de aplicación**
(``settings.application_timezone``), nunca en la del host, contenedor, navegador o
PostgreSQL.

Calculamos los límites del día en esa zona de forma DST-safe (medianoche de pared de
``D`` y de ``D+1``, no ``inicio + 24h``) y los convertimos a UTC *naive* para
comparar contra la columna. Semántica para el usuario:

    on D       -> columna >= inicio(D)     AND columna < inicio(D+1)
    before D   -> columna <  inicio(D)
    after D    -> columna >= inicio(D+1)
    between A,B-> columna >= inicio(A)      AND columna < inicio(B+1)   (B inclusivo)
"""

from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

_UTC = ZoneInfo("UTC")


def day_start_utc(value: date, tz: ZoneInfo) -> datetime:
    """Inicio del día ``value`` (medianoche de pared en ``tz``) como ``datetime`` UTC naive."""
    local_midnight = datetime(value.year, value.month, value.day, tzinfo=tz)
    return local_midnight.astimezone(_UTC).replace(tzinfo=None)


def next_day_start_utc(value: date, tz: ZoneInfo) -> datetime:
    """Inicio del día siguiente a ``value`` como ``datetime`` UTC naive (límite exclusivo)."""
    return day_start_utc(value + timedelta(days=1), tz)
