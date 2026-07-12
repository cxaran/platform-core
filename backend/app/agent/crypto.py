"""Cifrado simétrico reversible para secretos de credenciales de proveedor de IA.

FastAPI es la autoridad que guarda las credenciales de proveedor de IA CIFRADAS en
reposo (el navegador no las guarda; el Gateway las arrienda por turno). Se escribe con
la clave maestra ``APP_ENCRYPTION_KEY`` y se descifra con la cadena completa de claves
configuradas. El secreto en claro nunca se persiste ni se loguea.

Generar una clave válida (urlsafe base64 de 32 bytes)::

    python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
"""

from __future__ import annotations

from backend.app.services.secret_cipher import (
    SecretCipherError,
    decrypt_secret as _decrypt,
    encrypt_secret as _encrypt,
)


def encrypt_secret(plaintext: str) -> str:
    """Cifra ``plaintext`` y devuelve el token Fernet (texto) para guardar en reposo."""
    try:
        return _encrypt(plaintext)
    except SecretCipherError as error:
        # Contrato histórico de este módulo: RuntimeError con causa accionable.
        raise RuntimeError(
            "No hay clave de cifrado configurada: define APP_ENCRYPTION_KEY (Fernet)."
        ) from error


def decrypt_secret(token: str) -> str:
    """Descifra un token Fernet y devuelve el secreto en claro (uso efímero)."""
    value = _decrypt(token)
    if value is None:
        raise RuntimeError(
            "La credencial guardada no puede descifrarse con las claves configuradas."
        )
    return value
