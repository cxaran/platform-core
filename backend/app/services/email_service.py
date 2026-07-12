"""Correo saliente CONFIGURABLE (slice de correo del sistema de configuración).

El transporte se resuelve desde ``system_settings`` (fuente de verdad editable):

- ``environment`` (default): usa las variables SMTP_* del entorno — Mailpit funciona
  solo en desarrollo. GUARDRAIL: en producción este modo se niega a usar un host que
  parezca Mailpit/localhost (jamás un fallback silencioso a un buzón de juguete).
- ``smtp``: credenciales guardadas en la fila (contraseña cifrada, write-only).
- ``resend``: API HTTPS de Resend con la key cifrada de la fila (sin SDK; httpx).

``send_system_email`` es best-effort para los flujos existentes (un fallo de correo
no revierte la operación que lo disparó) y devuelve el desenlace para quien sí
necesita saberlo (la acción de PRUEBA persiste el resultado en la fila). Los errores
reportados son SEGUROS: nunca credenciales ni volcados del proveedor.
"""

import logging
from dataclasses import dataclass
from typing import Optional

from sqlmodel import Session

from backend.app.core.settings import settings
from backend.app.models.system_settings import SystemSettings
from backend.app.services.secret_cipher import decrypt_secret

logger = logging.getLogger("backend.email")

_RESEND_ENDPOINT = "https://api.resend.com/emails"
_RESEND_TIMEOUT_SECONDS = 15.0

# Hosts que delatan un buzón de desarrollo: prohibidos como transporte de producción.
_DEV_MAIL_HOSTS = ("mailpit", "localhost", "127.0.0.1", "::1")


@dataclass(frozen=True)
class EmailOutcome:
    """Desenlace de un envío (para la acción de prueba y el checklist)."""

    sent: bool
    error_code: Optional[str] = None
    error_summary: Optional[str] = None


def transport_unavailable_reason(config: SystemSettings) -> Optional[str]:
    """``None`` si el transporte configurado puede usarse; si no, la causa legible.

    Es la MISMA regla que aplica el envío (el checklist la reutiliza): el modo
    environment en producción rechaza hosts de desarrollo; los modos smtp/resend
    exigen su configuración completa.
    """
    if config.email_mode == "environment":
        host = (settings.smtp_host or "").strip().lower()
        if settings.environment == "production" and any(
            host == dev or host.startswith(f"{dev}:") for dev in _DEV_MAIL_HOSTS
        ):
            return (
                "El transporte del entorno apunta a un buzón de desarrollo "
                f"({settings.smtp_host}); configura SMTP o Resend para producción."
            )
        return None
    if config.email_mode == "smtp":
        missing = [
            name
            for name, value in (
                ("servidor", config.email_smtp_host),
                ("puerto", config.email_smtp_port),
                ("remitente", config.email_from_address),
            )
            if not value
        ]
        if missing:
            return f"Configuración SMTP incompleta: falta {', '.join(missing)}."
        return None
    # resend
    missing = []
    if not config.email_resend_api_key_ciphertext:
        missing.append("API key")
    if not config.email_from_address:
        missing.append("remitente")
    if missing:
        return f"Configuración de Resend incompleta: falta {', '.join(missing)}."
    return None


def action_email_html(*, message: str, action_url: str, action_label: str) -> str:
    """Cuerpo HTML mínimo con un botón de acción (estilos inline para clientes de
    correo). El texto y la URL se escapan; el texto plano con la URL sigue siendo
    el fallback para clientes sin HTML."""
    import html as html_module

    safe_url = html_module.escape(action_url, quote=True)
    safe_label = html_module.escape(action_label)
    paragraphs = "".join(
        f'<p style="margin:0 0 12px 0;">{html_module.escape(line)}</p>'
        for line in message.splitlines()
        if line.strip()
    )
    return (
        '<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;'
        'line-height:1.6;color:#1f2937;max-width:520px;margin:0 auto;padding:24px;">'
        f"{paragraphs}"
        '<p style="margin:24px 0;">'
        f'<a href="{safe_url}" '
        'style="display:inline-block;background-color:#111827;color:#ffffff;'
        "text-decoration:none;padding:12px 24px;border-radius:8px;"
        'font-weight:bold;">'
        f"{safe_label}</a></p>"
        '<p style="margin:0;font-size:12px;color:#6b7280;">'
        "Si el botón no funciona, copia y pega este enlace en tu navegador:<br>"
        f'<a href="{safe_url}" style="color:#374151;word-break:break-all;">{safe_url}</a>'
        "</p></div>"
    )


async def _send_via_fastapi_mail(
    *, subject: str, email_to: str, message: str, connection_config, html: Optional[str] = None
) -> None:
    from fastapi_mail import FastMail, MessageSchema, MessageType
    from pydantic import NameEmail

    email = MessageSchema(
        subject=subject,
        recipients=[NameEmail(name=email_to, email=email_to)],
        body=html if html is not None else message,
        subtype=MessageType.html if html is not None else MessageType.plain,
    )
    await FastMail(connection_config).send_message(email)


def _smtp_connection_config(config: SystemSettings):
    from fastapi_mail import ConnectionConfig
    from pydantic import SecretStr

    password = (
        decrypt_secret(config.email_smtp_password_ciphertext)
        if config.email_smtp_password_ciphertext
        else None
    )
    return ConnectionConfig(
        MAIL_USERNAME=config.email_smtp_username or "",
        MAIL_PASSWORD=SecretStr(password or ""),
        MAIL_FROM=config.email_from_address or "",
        MAIL_FROM_NAME=config.email_from_name or config.email_from_address or "",
        MAIL_SERVER=config.email_smtp_host or "",
        MAIL_PORT=int(config.email_smtp_port or 587),
        MAIL_STARTTLS=config.email_smtp_tls,
        MAIL_SSL_TLS=config.email_smtp_ssl,
        USE_CREDENTIALS=bool(config.email_smtp_username),
        VALIDATE_CERTS=True,
    )


async def _send_via_resend(
    *, subject: str, email_to: str, message: str, config: SystemSettings, html: Optional[str] = None
) -> None:
    import httpx

    api_key = (
        decrypt_secret(config.email_resend_api_key_ciphertext)
        if config.email_resend_api_key_ciphertext
        else None
    )
    if not api_key:
        raise RuntimeError("resend_key_unavailable")
    sender = config.email_from_address or ""
    if config.email_from_name:
        sender = f"{config.email_from_name} <{sender}>"
    payload: dict[str, object] = {
        "from": sender,
        "to": [email_to],
        "subject": subject,
        "text": message,
    }
    if html is not None:
        payload["html"] = html
    async with httpx.AsyncClient(timeout=httpx.Timeout(_RESEND_TIMEOUT_SECONDS)) as client:
        response = await client.post(
            _RESEND_ENDPOINT,
            headers={"Authorization": f"Bearer {api_key}"},
            json=payload,
        )
    if response.status_code >= 400:
        # Sin volcar el cuerpo del proveedor (puede incluir el remitente/detalles).
        raise RuntimeError(f"resend_http_{response.status_code}")


async def send_system_email(
    session: Session,
    *,
    subject: str,
    email_to: str,
    message: str,
    html: Optional[str] = None,
) -> EmailOutcome:
    """Envía con el transporte configurado. Best-effort: NUNCA lanza.

    ``html`` es opcional (p. ej. botón de acción); ``message`` sigue siendo el
    texto plano — con Resend viajan ambos, con SMTP se prefiere el HTML."""
    from backend.app.services.system_settings_service import get_system_settings

    config = get_system_settings(session)
    reason = transport_unavailable_reason(config)
    if reason is not None:
        logger.warning("email transport unavailable: %s", reason)
        return EmailOutcome(sent=False, error_code="transport_unavailable", error_summary=reason)

    try:
        if config.email_mode == "resend":
            await _send_via_resend(
                subject=subject, email_to=email_to, message=message, config=config, html=html
            )
        elif config.email_mode == "smtp":
            await _send_via_fastapi_mail(
                subject=subject,
                email_to=email_to,
                message=message,
                connection_config=_smtp_connection_config(config),
                html=html,
            )
        else:
            await _send_via_fastapi_mail(
                subject=subject,
                email_to=email_to,
                message=message,
                connection_config=settings.mail_config,
                html=html,
            )
    except Exception as error:
        # Resumen SEGURO: clase del error / código propio, jamás credenciales.
        summary = str(error) if str(error).startswith("resend_") else type(error).__name__
        logger.warning("email sending failed (%s): %s", config.email_mode, summary)
        return EmailOutcome(sent=False, error_code="send_failed", error_summary=summary)
    return EmailOutcome(sent=True)
