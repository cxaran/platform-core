"""Web Push (VAPID) hacia los dispositivos suscritos de cada usuario.

Tercer medio de la fila de notificación (campana + correo + push). El envío
usa ``pywebpush`` (cifrado RFC 8291 + firma VAPID). Las claves VAPID del
despliegue se AUTOGENERAN en el primer uso y viven en ``web_push_credentials``
(privada cifrada con Fernet); el navegador recibe la pública como
``applicationServerKey``.

La cola vive en ``notifications.push_status`` (pending→sent/failed/skipped),
despachada con el MISMO patrón que los correos: hilo best-effort post-commit
y tick Taskiq con ``FOR UPDATE SKIP LOCKED``. Una suscripción que el push
service reporta muerta (404/410) se BORRA en el acto.
"""

import json
import logging
import uuid
from typing import Optional

from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, select

from backend.app.core.settings import settings
from backend.app.models.notification import Notification
from backend.app.models.push import (
    WEB_PUSH_CREDENTIAL_ID,
    PushSubscription,
    WebPushCredential,
)
from backend.app.models.user import User
from backend.app.services.secret_cipher import (
    SecretCipherError,
    decrypt_secret,
    encrypt_secret,
)
from backend.app.utils.utc_now import utc_now

logger = logging.getLogger(__name__)

PUSH_BATCH_SIZE = 50
# El aviso pierde sentido pasado un día (el correo y la campana son el registro
# durable): el push service lo descarta si el dispositivo no aparece antes.
PUSH_TTL_SECONDS = 60 * 60 * 24


class PushConfigError(Exception):
    """Las credenciales VAPID no pueden generarse/leerse (p. ej. sin Fernet)."""

    def __init__(self, code: str, summary: str) -> None:
        super().__init__(summary)
        self.code = code
        self.summary = summary


# ---------------------------------------------------------------------------
# Credenciales VAPID (autogeneradas, singleton)
# ---------------------------------------------------------------------------

def _generate_vapid_pair() -> tuple[str, str]:
    """Genera un par P-256 nuevo → (public_key base64url, private_pem)."""
    from cryptography.hazmat.primitives import serialization
    from py_vapid import Vapid02, b64urlencode

    vapid = Vapid02()
    vapid.generate_keys()
    public_key = b64urlencode(
        vapid.public_key.public_bytes(  # pyright: ignore[reportOptionalMemberAccess]
            serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint
        )
    )
    private_pem = vapid.private_pem().decode("utf-8")
    return public_key, private_pem


def get_vapid_credentials(session: Session) -> tuple[str, str]:
    """Devuelve (public_key, private_pem); genera y persiste si aún no existen.

    PK fija: si dos workers generan a la vez, el perdedor del INSERT relee la
    fila del ganador — todas las suscripciones nacen de la MISMA clave pública.
    """
    row = session.get(WebPushCredential, WEB_PUSH_CREDENTIAL_ID)
    if row is None:
        public_key, private_pem = _generate_vapid_pair()
        try:
            encrypted = encrypt_secret(private_pem)
        except SecretCipherError as error:
            raise PushConfigError(error.code, error.summary) from error
        row = WebPushCredential(
            id=WEB_PUSH_CREDENTIAL_ID,
            public_key=public_key,
            private_key_encrypted=encrypted,
        )
        try:
            with session.begin_nested():
                session.add(row)
        except IntegrityError:
            row = session.get(WebPushCredential, WEB_PUSH_CREDENTIAL_ID)
            if row is None:  # pragma: no cover — carrera perdida sin fila: imposible
                raise PushConfigError(
                    "vapid_unavailable", "No fue posible obtener las credenciales VAPID."
                ) from None
    private_pem = decrypt_secret(row.private_key_encrypted)
    if private_pem is None:
        raise PushConfigError(
            "vapid_undecryptable",
            "La clave privada VAPID no descifra con las claves configuradas.",
        )
    return row.public_key, private_pem


def get_vapid_public_key(session: Session) -> str:
    return get_vapid_credentials(session)[0]


# ---------------------------------------------------------------------------
# Suscripciones por dispositivo
# ---------------------------------------------------------------------------

def save_subscription(
    session: Session,
    *,
    user_id: uuid.UUID,
    endpoint: str,
    p256dh: str,
    auth: str,
    user_agent: Optional[str] = None,
) -> PushSubscription:
    """Alta/refresco de la suscripción de UN navegador (upsert por endpoint).

    El endpoint es único globalmente: si otro usuario inició sesión en el mismo
    navegador, la suscripción cambia de dueño (el dispositivo es del usuario
    con la sesión activa, no del anterior).
    """
    row = session.exec(
        select(PushSubscription).where(PushSubscription.endpoint == endpoint)
    ).first()
    if row is None:
        row = PushSubscription(user_id=user_id, endpoint=endpoint, p256dh=p256dh, auth=auth)
    row.user_id = user_id
    row.p256dh = p256dh
    row.auth = auth
    row.user_agent = (user_agent or "")[:255] or None
    row.last_seen_at = utc_now()
    session.add(row)
    session.flush()
    return row


def remove_subscription(session: Session, *, user_id: uuid.UUID, endpoint: str) -> bool:
    """Baja de la suscripción PROPIA (jamás borra la de otro usuario)."""
    row = session.exec(
        select(PushSubscription).where(
            PushSubscription.endpoint == endpoint,
            PushSubscription.user_id == user_id,
        )
    ).first()
    if row is None:
        return False
    session.delete(row)
    session.flush()
    return True


# ---------------------------------------------------------------------------
# Despacho de la cola push
# ---------------------------------------------------------------------------

def _notification_url(row: Notification) -> str:
    """A dónde lleva el clic en la notificación (mismo destino que la campana:
    ``notification_href``). Fallback a la raíz si no hay destino."""
    from backend.app.services.notification_service import notification_href

    return notification_href(row.kind, row.link_url) or "/"


def _send_webpush(
    subscription: PushSubscription, payload: str, *, private_pem: str
) -> Optional[int]:
    """Envía UN push. Devuelve None si se aceptó; el status HTTP si falló.

    Función a nivel de módulo para poder sustituirla en tests (mismo patrón
    que ``send_system_email``).
    """
    from pywebpush import WebPushException, webpush

    claims_sub = f"mailto:{settings.smtp_from_email or 'admin@example.com'}"
    try:
        webpush(
            subscription_info={
                "endpoint": subscription.endpoint,
                "keys": {"p256dh": subscription.p256dh, "auth": subscription.auth},
            },
            data=payload,
            vapid_private_key=private_pem,
            vapid_claims={"sub": claims_sub},
            ttl=PUSH_TTL_SECONDS,
        )
        return None
    except WebPushException as error:
        response = getattr(error, "response", None)
        return getattr(response, "status_code", None) or 0


def dispatch_pending_pushes(session: Session, *, limit: int = PUSH_BATCH_SIZE) -> int:
    """Empuja las notificaciones pendientes a los dispositivos suscritos.

    Por fila: sin suscripciones (o usuario inactivo) → ``skipped``; al menos un
    dispositivo aceptó → ``sent``; todos fallaron → ``failed``. Suscripciones
    404/410 se borran. Devuelve cuántas filas quedaron ``sent``.
    """
    stmt = (
        select(Notification)
        .where(Notification.push_status == "pending")
        .order_by(Notification.created_at)  # pyright: ignore[reportArgumentType]
        .limit(limit)
    )
    if session.get_bind().dialect.name == "postgresql":
        stmt = stmt.with_for_update(skip_locked=True)
    rows = session.exec(stmt).all()
    if not rows:
        return 0

    try:
        _, private_pem = get_vapid_credentials(session)
    except PushConfigError as error:
        # Sin credenciales utilizables no hay push posible: se marca todo el
        # lote 'failed' con el motivo (la campana y el correo ya cubrieron).
        for row in rows:
            row.push_status = "failed"
            row.push_error = error.summary[:200]
            session.add(row)
        session.flush()
        return 0

    sent = 0
    for row in rows:
        user = session.get(User, row.user_id)
        if user is None or not user.is_active:
            row.push_status = "skipped"
            session.add(row)
            continue
        subscriptions = session.exec(
            select(PushSubscription).where(PushSubscription.user_id == row.user_id)
        ).all()
        if not subscriptions:
            row.push_status = "skipped"
            session.add(row)
            continue

        payload = json.dumps(
            {
                "title": row.title,
                "body": row.body,
                "kind": row.kind,
                "url": _notification_url(row),
                "notification_id": str(row.id),
            },
            ensure_ascii=False,
        )
        delivered = 0
        last_status: Optional[int] = None
        for subscription in subscriptions:
            status = _send_webpush(subscription, payload, private_pem=private_pem)
            if status is None:
                delivered += 1
            elif status in (404, 410):
                # Suscripción muerta según el push service: higiene inmediata.
                session.delete(subscription)
            else:
                last_status = status
        if delivered:
            row.push_status = "sent"
            row.push_error = None
            sent += 1
        elif last_status is None:
            # Todas las suscripciones estaban muertas: nada que empujar.
            row.push_status = "skipped"
        else:
            row.push_status = "failed"
            row.push_error = f"push_http_{last_status}"[:200]
        session.add(row)
    session.flush()
    return sent
