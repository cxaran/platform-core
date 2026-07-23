"""Cifrado simétrico de SECRETOS de configuración en reposo (Fernet).

Una sola clave maestra: ``APP_ENCRYPTION_KEY`` (obligatoria en producción).
Cifra y descifra todos los secretos guardados en la base (SMTP, Resend, OAuth,
refresh tokens de Drive, credenciales de proveedor de IA). La clave vive SOLO
en el entorno: nunca en la base de datos que cifra.
"""

from typing import Optional

from backend.app.core.settings import settings


class SecretCipherError(Exception):
    """La clave de cifrado no está configurada o el material no descifra."""

    def __init__(self, code: str, summary: str) -> None:
        super().__init__(summary)
        self.code = code
        self.summary = summary


def _master_key() -> Optional[str]:
    secret = settings.app_encryption_key
    if secret is None:
        return None
    return secret.get_secret_value() or None


def has_encryption_key() -> bool:
    return _master_key() is not None


def _fernet():
    from cryptography.fernet import Fernet

    key = _master_key()
    if key is None:
        raise SecretCipherError(
            "encryption_key_missing",
            "Configura APP_ENCRYPTION_KEY para guardar secretos cifrados.",
        )
    try:
        return Fernet(key.encode("utf-8"))
    except Exception as error:
        raise SecretCipherError(
            "encryption_key_invalid",
            "La clave de cifrado no es una clave Fernet válida.",
        ) from error


def encrypt_secret(plaintext: str) -> str:
    """Cifra con la clave maestra y devuelve el token Fernet (texto)."""
    return _fernet().encrypt(plaintext.encode("utf-8")).decode("utf-8")


def decrypt_secret(ciphertext: str) -> Optional[str]:
    """Descifra con la clave maestra; ``None`` si el material no corresponde."""
    from cryptography.fernet import Fernet, InvalidToken

    key = _master_key()
    if key is None:
        return None
    try:
        return Fernet(key.encode("utf-8")).decrypt(ciphertext.encode("utf-8")).decode("utf-8")
    except (InvalidToken, ValueError):
        return None
    except Exception:
        return None
