"""Web Push: suscripciones por dispositivo y credenciales VAPID del despliegue.

- ``push_subscriptions``: una fila por navegador/dispositivo suscrito de un
  usuario (endpoint único del push service + claves de cifrado del navegador).
  Se BORRA (hard delete) cuando el push service responde 404/410 (suscripción
  muerta) o cuando el usuario se desuscribe: no es un registro de negocio.
- ``web_push_credentials``: par VAPID del despliegue, AUTOGENERADO en el primer
  uso (fila única con PK fija). La clave privada se guarda cifrada con Fernet
  (``secret_cipher``) — nunca en claro; la pública viaja al navegador como
  ``applicationServerKey``.
"""

import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import DateTime, ForeignKey, Index, String, Text, func
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base

# PK fija del singleton VAPID: dos workers que generen a la vez chocan en la PK
# y el perdedor relee la fila del ganador (todas las suscripciones deben nacer
# de la MISMA clave pública).
WEB_PUSH_CREDENTIAL_ID = uuid.UUID("00000000-0000-4000-a000-7e6b9c5d0001")


class PushSubscription(Base):
    __tablename__ = "push_subscriptions"
    __table_args__ = (Index("ix_push_subscriptions_user", "user_id"),)

    id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("user.id", ondelete="CASCADE"), nullable=False
    )
    # URL única que asigna el push service (FCM/Mozilla/Apple) a ESTE navegador.
    endpoint: Mapped[str] = mapped_column(Text, nullable=False, unique=True)
    # Claves públicas del NAVEGADOR para cifrar el payload (RFC 8291).
    p256dh: Mapped[str] = mapped_column(String(255), nullable=False)
    auth: Mapped[str] = mapped_column(String(255), nullable=False)
    user_agent: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    last_seen_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )


class WebPushCredential(Base):
    __tablename__ = "web_push_credentials"

    id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True), primary_key=True, default=lambda: WEB_PUSH_CREDENTIAL_ID
    )
    # Clave pública P-256 en base64url (punto sin comprimir): applicationServerKey.
    public_key: Mapped[str] = mapped_column(String(255), nullable=False)
    # PEM de la clave privada, cifrado con Fernet (secret_cipher).
    private_key_encrypted: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
