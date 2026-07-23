"""Flujo OAuth browser-callback PKCE para conectar la cuenta ChatGPT Plus/Codex.

Patrón Codex: NO device-code. El navegador del usuario autoriza en el proveedor
y vuelve con un ``code`` que FastAPI intercambia (con el ``code_verifier`` PKCE
guardado server-side) por un perfil ``{access, refresh, expires, account_id}``.
Ese perfil se guarda CIFRADO (Fernet, vía ``secret_cipher``) en la credencial
del usuario (``provider=openai`` / ``credential_type=oauth``) y nunca se
devuelve en claro. El arriendo interno entrega el access token vigente
(refrescándolo si vence) al Agent Gateway para el proveedor ``openai_codex``.

SEGURIDAD: este módulo NUNCA loguea access/refresh tokens, el ``code`` ni el
``code_verifier``. El intercambio/refresh HTTP es un único punto
(``_post_token``) que los tests mockean; no hay llamadas reales en pruebas.
"""

from __future__ import annotations

import base64
import binascii
import hashlib
import json
import secrets
import threading
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any
from urllib.parse import urlencode

import httpx

from backend.app.core.settings import settings
from backend.app.services.secret_cipher import (
    SecretCipherError,
    decrypt_secret,
    encrypt_secret,
)


class OAuthError(Exception):
    """Error del flujo OAuth con un ``code`` estable y un mensaje sin secretos."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


# --- PKCE ----------------------------------------------------------------------


def generate_code_verifier() -> str:
    """Genera un ``code_verifier`` PKCE (urlsafe, longitud válida 43-128)."""
    return secrets.token_urlsafe(64)


def code_challenge_s256(verifier: str) -> str:
    """Deriva el ``code_challenge`` S256 (base64url sin padding) del verifier."""
    digest = hashlib.sha256(verifier.encode("ascii")).digest()
    return base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")


def generate_state() -> str:
    """Genera el ``state`` anti-CSRF que liga el inicio con el callback."""
    return secrets.token_urlsafe(32)


def build_authorize_url(
    *,
    authorize_url: str,
    client_id: str,
    redirect_uri: str,
    code_challenge: str,
    state: str,
    scope: str,
) -> str:
    """Construye la URL de autorización con los parámetros PKCE."""
    params = {
        "response_type": "code",
        "client_id": client_id,
        "redirect_uri": redirect_uri,
        "code_challenge": code_challenge,
        "code_challenge_method": "S256",
        "state": state,
        "scope": scope,
    }
    separator = "&" if "?" in authorize_url else "?"
    return f"{authorize_url}{separator}{urlencode(params)}"


# --- Almacén efímero del verifier ---------------------------------------------
#
# Decisión: el ``code_verifier`` vive en memoria de proceso, indexado por
# (user_id, state), con TTL corto. Es deliberadamente NO durable: el flujo se
# completa en segundos; un reinicio entre /start y /complete simplemente obliga
# a reiniciar el flujo ("estado OAuth inválido"). No se persiste en la BD para
# no dejar material PKCE en reposo. Con múltiples workers (gunicorn), mover a
# Redis con el mismo contrato (put/take con TTL).


@dataclass
class _PkceEntry:
    code_verifier: str
    created_at: float


class PkceStore:
    """Almacén en memoria, con TTL, del ``code_verifier`` por (user_id, state)."""

    def __init__(self, ttl_seconds: int = 600) -> None:
        self._ttl = ttl_seconds
        self._entries: dict[tuple[str, str], _PkceEntry] = {}
        self._lock = threading.Lock()

    def put(self, user_id: str, state: str, code_verifier: str) -> None:
        with self._lock:
            self._prune_locked()
            self._entries[(user_id, state)] = _PkceEntry(code_verifier, time.monotonic())

    def take(self, user_id: str, state: str) -> str | None:
        """Saca (pop) el verifier si existe y no expiró; si no, devuelve ``None``."""
        with self._lock:
            self._prune_locked()
            entry = self._entries.pop((user_id, state), None)
            if entry is None:
                return None
            if time.monotonic() - entry.created_at > self._ttl:
                return None
            return entry.code_verifier

    def _prune_locked(self) -> None:
        now = time.monotonic()
        expired = [
            key
            for key, entry in self._entries.items()
            if now - entry.created_at > self._ttl
        ]
        for key in expired:
            self._entries.pop(key, None)


pkce_store = PkceStore()


# --- Perfil OAuth cifrado ------------------------------------------------------


def encode_oauth_profile(profile: dict[str, Any]) -> str:
    """Serializa el perfil a JSON y lo CIFRA con Fernet para guardar en reposo."""
    try:
        return encrypt_secret(json.dumps(profile, separators=(",", ":"), sort_keys=True))
    except SecretCipherError as exc:
        raise OAuthError(exc.code, exc.summary) from exc


def decode_oauth_profile(token: str) -> dict[str, Any]:
    """Descifra y deserializa el perfil OAuth (uso efímero, nunca se loguea)."""
    plaintext = decrypt_secret(token)
    if plaintext is None:
        raise OAuthError(
            "oauth_profile_undecryptable",
            "El perfil OAuth guardado no puede descifrarse; vuelve a conectar la cuenta.",
        )
    data = json.loads(plaintext)
    if not isinstance(data, dict):
        raise OAuthError("oauth_profile_invalid", "Perfil OAuth almacenado inválido.")
    return data


# --- Cliente de token (único punto HTTP; mockeable en tests) -------------------


def _post_token(payload: dict[str, str]) -> dict[str, Any]:
    """POST x-www-form-urlencoded al TOKEN_URL. Único seam HTTP (tests lo mockean).

    Nunca loguea el payload ni la respuesta (contienen el code y tokens)."""
    url = settings.openai_oauth_token_url
    try:
        response = httpx.post(url, data=payload, timeout=httpx.Timeout(15.0))
    except httpx.HTTPError as exc:
        raise OAuthError(
            "oauth_token_request_failed",
            "No se pudo contactar al proveedor OAuth.",
        ) from exc
    if response.status_code >= 400:
        # No se incluye el cuerpo de error verbatim para no arriesgar fugas.
        raise OAuthError(
            "oauth_token_rejected",
            "El proveedor OAuth rechazó la solicitud de token.",
        )
    try:
        data = response.json()
    except ValueError as exc:
        raise OAuthError(
            "oauth_token_invalid_response",
            "Respuesta inválida del proveedor OAuth.",
        ) from exc
    if not isinstance(data, dict):
        raise OAuthError(
            "oauth_token_invalid_response",
            "Respuesta inválida del proveedor OAuth.",
        )
    return data


def _now_epoch() -> int:
    return int(datetime.now(timezone.utc).timestamp())


def _decode_jwt_claims(token: str) -> dict[str, Any]:
    """Decodifica el payload de un JWT SIN verificar la firma (solo para account_id).

    El id_token llega por TLS desde el TOKEN_URL; aquí solo se extrae el id de
    cuenta, no se confía en él para autenticación. Cualquier error -> {}."""
    parts = token.split(".")
    if len(parts) < 2:
        return {}
    payload = parts[1]
    padding = "=" * (-len(payload) % 4)
    try:
        raw = base64.urlsafe_b64decode(payload + padding)
        claims = json.loads(raw)
    except (binascii.Error, ValueError):
        return {}
    return claims if isinstance(claims, dict) else {}


def _extract_account_id(token_response: dict[str, Any]) -> str | None:
    """Extrae el ``account_id`` de la cuenta ChatGPT del token response.

    Acepta un campo directo o lo deriva del id_token (claim de OpenAI o top-level),
    siguiendo el patrón Codex."""
    direct = token_response.get("account_id")
    if isinstance(direct, str) and direct:
        return direct
    id_token = token_response.get("id_token")
    if isinstance(id_token, str) and id_token:
        claims = _decode_jwt_claims(id_token)
        auth = claims.get("https://api.openai.com/auth")
        if isinstance(auth, dict):
            for key in ("chatgpt_account_id", "account_id"):
                value = auth.get(key)
                if isinstance(value, str) and value:
                    return value
        for key in ("chatgpt_account_id", "account_id"):
            value = claims.get(key)
            if isinstance(value, str) and value:
                return value
    return None


def _profile_from_token(
    token_response: dict[str, Any], *, fallback: dict[str, Any] | None = None
) -> dict[str, Any]:
    """Arma el perfil {access, refresh, expires, account_id} desde el token response.

    Conserva refresh/account_id previos cuando el proveedor no los reemite (típico
    en un refresh donde el refresh token no rota)."""
    fallback = fallback or {}
    access = token_response.get("access_token")
    if not isinstance(access, str) or not access:
        raise OAuthError("oauth_no_access_token", "El proveedor no devolvió un access token.")

    refresh = token_response.get("refresh_token")
    if not isinstance(refresh, str) or not refresh:
        refresh = fallback.get("refresh")

    expires_in = token_response.get("expires_in")
    if isinstance(expires_in, (int, float)) and expires_in > 0:
        expires = _now_epoch() + int(expires_in)
    else:
        expires = fallback.get("expires", _now_epoch())

    account_id = _extract_account_id(token_response) or fallback.get("account_id")

    return {
        "access": access,
        "refresh": refresh,
        "expires": int(expires),
        "account_id": account_id,
    }


def exchange_code(*, code: str, code_verifier: str, redirect_uri: str) -> dict[str, Any]:
    """Intercambia el ``code`` por el perfil OAuth (grant authorization_code + PKCE)."""
    payload = {
        "grant_type": "authorization_code",
        "code": code,
        "code_verifier": code_verifier,
        "client_id": settings.openai_oauth_client_id or "",
        "redirect_uri": redirect_uri,
    }
    token_response = _post_token(payload)
    return _profile_from_token(token_response)


def refresh_access_token(*, refresh_token: str) -> dict[str, Any]:
    """Pide un token response nuevo con grant_type=refresh_token."""
    payload = {
        "grant_type": "refresh_token",
        "refresh_token": refresh_token,
        "client_id": settings.openai_oauth_client_id or "",
    }
    return _post_token(payload)


def ensure_fresh_access_token(
    profile: dict[str, Any],
    *,
    skew_seconds: int | None = None,
) -> tuple[dict[str, Any], bool]:
    """Devuelve (perfil, refrescado).

    Si el access token sigue vigente (con margen ``skew``), devuelve el perfil tal
    cual y ``False``. Si venció o está por vencer, lo refresca con el refresh token
    y devuelve el perfil actualizado y ``True``."""
    if skew_seconds is None:
        skew_seconds = settings.openai_oauth_refresh_skew_seconds

    expires = profile.get("expires")
    if isinstance(expires, (int, float)) and expires - _now_epoch() > skew_seconds:
        return profile, False

    refresh = profile.get("refresh")
    if not isinstance(refresh, str) or not refresh:
        raise OAuthError(
            "oauth_refresh_unavailable",
            "La conexión OAuth no tiene refresh token; vuelve a conectar la cuenta.",
        )

    token_response = refresh_access_token(refresh_token=refresh)
    new_profile = _profile_from_token(token_response, fallback=profile)
    return new_profile, True


def profile_expires_at(profile: dict[str, Any]) -> datetime | None:
    """Vencimiento del access token como datetime naive UTC (consistente con utc_now)."""
    expires = profile.get("expires")
    if not isinstance(expires, (int, float)):
        return None
    return datetime.fromtimestamp(int(expires), tz=timezone.utc).replace(tzinfo=None)
