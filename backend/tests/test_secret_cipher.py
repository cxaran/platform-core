"""Tests del cifrador de secretos de configuración (services/secret_cipher.py).

Cubre la cadena de claves (escritura con la primaria, descifrado probando la
cadena completa) y los errores de configuración. La instancia global de settings
se parcha por test: las claves viven solo en el entorno.
"""

import os
import unittest
from unittest.mock import patch

os.environ.setdefault("ENVIRONMENT", "local")
os.environ.setdefault("SECRET_KEY", "test-secret-key")
os.environ.setdefault("ACCESS_TOKEN_EXPIRE_MINUTES", "30")
os.environ.setdefault("EMAIL_TOKEN_EXPIRE_MINUTES", "30")
os.environ.setdefault("TRYS_BEFORE_LOCK", "5")
os.environ.setdefault("REDIS_HOST", "redis")
os.environ.setdefault("REDIS_PORT", "6379")
os.environ.setdefault("REDIS_DB", "0")
os.environ.setdefault("SMTP_HOST", "mailpit")
os.environ.setdefault("SMTP_PORT", "1025")
os.environ.setdefault("SMTP_USER", "test@example.com")
os.environ.setdefault("SMTP_PASSWORD", "test-password")
os.environ.setdefault("SMTP_FROM_EMAIL", "test@example.com")
os.environ.setdefault("SMTP_FROM_NAME", "Platform Core Test")
os.environ.setdefault("SMTP_TLS", "false")
os.environ.setdefault("SMTP_SSL", "false")
os.environ.setdefault("SMTP_USE_CREDENTIALS", "false")
os.environ.setdefault("POSTGRES_USER", "platform")
os.environ.setdefault("POSTGRES_PASSWORD", "platform")
os.environ.setdefault("POSTGRES_SERVER", "postgres")
os.environ.setdefault("POSTGRES_PORT", "5432")
os.environ.setdefault("POSTGRES_DB", "platform_core")

from cryptography.fernet import Fernet  # noqa: E402
from pydantic import SecretStr  # noqa: E402

from backend.app.services import secret_cipher  # noqa: E402
from backend.app.services.secret_cipher import (  # noqa: E402
    SecretCipherError,
    decrypt_secret,
    encrypt_secret,
    has_encryption_key,
)


def _patched(app_key: str | None, backup_key: str | None):
    return patch.multiple(
        secret_cipher.settings,
        app_encryption_key=SecretStr(app_key) if app_key else None,
        backup_token_encryption_key=SecretStr(backup_key) if backup_key else None,
    )


class SecretCipherTest(unittest.TestCase):
    def test_sin_clave_no_hay_cifrado(self) -> None:
        with _patched(None, None):
            self.assertFalse(has_encryption_key())
            with self.assertRaises(SecretCipherError) as ctx:
                encrypt_secret("hola")
            self.assertEqual(ctx.exception.code, "encryption_key_missing")
            self.assertIsNone(decrypt_secret("material-invalido"))

    def test_clave_invalida_reporta_error_de_configuracion(self) -> None:
        with _patched("no-es-fernet", None):
            with self.assertRaises(SecretCipherError) as ctx:
                encrypt_secret("hola")
            self.assertEqual(ctx.exception.code, "encryption_key_invalid")

    def test_roundtrip_con_clave_primaria(self) -> None:
        key = Fernet.generate_key().decode()
        with _patched(key, None):
            self.assertTrue(has_encryption_key())
            ciphertext = encrypt_secret("secreto smtp")
            self.assertNotIn("secreto", ciphertext)
            self.assertEqual(decrypt_secret(ciphertext), "secreto smtp")

    def test_material_viejo_descifra_con_clave_legada(self) -> None:
        legacy = Fernet.generate_key().decode()
        primary = Fernet.generate_key().decode()
        with _patched(None, legacy):
            old_ciphertext = encrypt_secret("token de drive")
        with _patched(primary, legacy):
            # El material cifrado con la legada sigue abriéndose...
            self.assertEqual(decrypt_secret(old_ciphertext), "token de drive")
            # ...pero toda ESCRITURA nueva usa la primaria (re-cifrado perezoso).
            new_ciphertext = encrypt_secret("token de drive")
        with _patched(primary, None):
            self.assertEqual(decrypt_secret(new_ciphertext), "token de drive")
            self.assertIsNone(decrypt_secret(old_ciphertext))

    def test_material_ajeno_devuelve_none(self) -> None:
        key = Fernet.generate_key().decode()
        other = Fernet.generate_key().decode()
        with _patched(other, None):
            foreign = encrypt_secret("de otra instalación")
        with _patched(key, None):
            self.assertIsNone(decrypt_secret(foreign))


if __name__ == "__main__":
    unittest.main()
