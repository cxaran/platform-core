"""Cifrado simétrico de SECRETOS de configuración en reposo (Fernet).

CLAVE MAESTRA ÚNICA con transición suave: se ESCRIBE siempre con la primaria
(``APP_ENCRYPTION_KEY``; si no está definida, cae a ``BACKUP_TOKEN_ENCRYPTION_KEY``
para no romper despliegues previos) y se DESCIFRA probando la cadena completa
(app → backup_token). El re-cifrado es PEREZOSO: como toda escritura usa la
primaria, el material viejo migra de clave la próxima vez que su registro se
reescribe — sin migración masiva ni ventana de indisponibilidad.

Las claves viven SOLO en el entorno: nunca en la base de datos que cifran.
"""

from typing import Optional

from backend.app.core.settings import settings


class SecretCipherError(Exception):
    """La clave de cifrado no está configurada o el material no descifra."""

    def __init__(self, code: str, summary: str) -> None:
        super().__init__(summary)
        self.code = code
        self.summary = summary


def _candidate_keys() -> list[str]:
    keys: list[str] = []
    for secret in (
        settings.app_encryption_key,
        settings.backup_token_encryption_key,
    ):
        if secret is not None:
            value = secret.get_secret_value()
            if value and value not in keys:
                keys.append(value)
    return keys


def has_encryption_key() -> bool:
    return bool(_candidate_keys())


def _primary_fernet():
    from cryptography.fernet import Fernet

    keys = _candidate_keys()
    if not keys:
        raise SecretCipherError(
            "encryption_key_missing",
            "Configura APP_ENCRYPTION_KEY para guardar secretos cifrados.",
        )
    try:
        return Fernet(keys[0].encode("utf-8"))
    except Exception as error:
        raise SecretCipherError(
            "encryption_key_invalid",
            "La clave de cifrado no es una clave Fernet válida.",
        ) from error


def encrypt_secret(plaintext: str) -> str:
    """Cifra SIEMPRE con la clave primaria (la primera de la cadena)."""
    return _primary_fernet().encrypt(plaintext.encode("utf-8")).decode("utf-8")


def decrypt_secret(ciphertext: str) -> Optional[str]:
    """Descifra probando la CADENA de claves (transición entre claves maestras);
    ``None`` si ninguna corresponde al material."""
    from cryptography.fernet import Fernet, InvalidToken

    for key in _candidate_keys():
        try:
            return Fernet(key.encode("utf-8")).decrypt(ciphertext.encode("utf-8")).decode("utf-8")
        except (InvalidToken, ValueError):
            continue
        except Exception:
            continue
    return None
