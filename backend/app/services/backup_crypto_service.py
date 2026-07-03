"""Cifrado del ARCHIVO de respaldo con el binario ``age`` (clave pública del admin).

El administrador configura únicamente el recipient PÚBLICO (``age1...``); la identidad
privada vive fuera del sistema (nunca se acepta, guarda ni loguea). El refresh token de
Google NO se cifra aquí (eso es Fernet con BACKUP_TOKEN_ENCRYPTION_KEY, ver
``backup_service``). Todas las invocaciones usan ``subprocess.run`` con lista de
argumentos y ``shell=False``.
"""

import hashlib
import subprocess
from pathlib import Path

# Tiempo máximo del cifrado (archivos grandes en discos lentos); la validación del
# recipient es instantánea (entrada vacía).
_ENCRYPT_TIMEOUT_SECONDS = 60 * 30
_VALIDATE_TIMEOUT_SECONDS = 30


class BackupCryptoError(Exception):
    """Error del cifrado (recipient inválido o fallo de age). El mensaje es SEGURO
    (no incluye el recipient completo ni rutas)."""

    def __init__(self, code: str, summary: str) -> None:
        super().__init__(summary)
        self.code = code
        self.summary = summary


def age_recipient_fingerprint(recipient: str) -> str:
    """Huella corta y estable del recipient (sha256 hex truncado a 16), para mostrar
    en la configuración y sellar cada respaldo sin exponer el recipient completo."""
    return hashlib.sha256(recipient.strip().encode("utf-8")).hexdigest()[:16]


def validate_age_recipient(recipient: str) -> None:
    """Valida el recipient invocando ``age`` con ENTRADA VACÍA (no cifra nada real).

    Un recipient corrupto hace fallar a age inmediatamente; uno válido produce un
    ciphertext vacío que se descarta. Lanza ``BackupCryptoError`` si no es utilizable.
    """
    candidate = recipient.strip()
    if not candidate or any(char.isspace() for char in candidate):
        raise BackupCryptoError(
            "age_recipient_invalid", "El recipient de age no puede contener espacios."
        )
    try:
        result = subprocess.run(
            ["age", "--encrypt", "--recipient", candidate],
            input=b"",
            capture_output=True,
            shell=False,
            check=False,
            timeout=_VALIDATE_TIMEOUT_SECONDS,
        )
    except FileNotFoundError as error:
        raise BackupCryptoError(
            "age_binary_missing", "El binario age no está instalado en la imagen."
        ) from error
    except subprocess.TimeoutExpired as error:
        raise BackupCryptoError(
            "age_validate_timeout", "La validación del recipient de age excedió el tiempo."
        ) from error
    if result.returncode != 0:
        # stderr de age no lleva secretos, pero se descarta igual: el resumen es fijo.
        raise BackupCryptoError(
            "age_recipient_invalid", "El recipient de age no es válido."
        )


def encrypt_file_with_age(plain_path: Path, encrypted_path: Path, recipient: str) -> None:
    """Cifra ``plain_path`` hacia ``encrypted_path`` con el recipient público."""
    try:
        result = subprocess.run(
            [
                "age",
                "--encrypt",
                "--recipient",
                recipient.strip(),
                "--output",
                str(encrypted_path),
                str(plain_path),
            ],
            capture_output=True,
            shell=False,
            check=False,
            timeout=_ENCRYPT_TIMEOUT_SECONDS,
        )
    except FileNotFoundError as error:
        raise BackupCryptoError(
            "age_binary_missing", "El binario age no está instalado en la imagen."
        ) from error
    except subprocess.TimeoutExpired as error:
        raise BackupCryptoError(
            "age_encrypt_timeout", "El cifrado del respaldo excedió el tiempo máximo."
        ) from error
    if result.returncode != 0 or not encrypted_path.exists():
        raise BackupCryptoError(
            "age_encrypt_failed", "El cifrado del respaldo con age falló."
        )


def generate_age_keypair() -> tuple[str, str]:
    """Genera un par de claves age con ``age-keygen`` y devuelve
    ``(recipient_publico, identidad_privada)``.

    La identidad (``AGE-SECRET-KEY-1…``) es la que ABRE los respaldos: quien la llama
    debe hacerla llegar al administrador (correo) y/o guardarla cifrada — perderla
    vuelve ilegibles los respaldos cifrados con su recipient.
    """
    try:
        result = subprocess.run(
            ["age-keygen"],
            capture_output=True,
            shell=False,
            check=False,
            timeout=_VALIDATE_TIMEOUT_SECONDS,
            text=True,
        )
    except FileNotFoundError as error:
        raise BackupCryptoError(
            "age_keygen_missing", "El binario age-keygen no está instalado en la imagen."
        ) from error
    except subprocess.TimeoutExpired as error:
        raise BackupCryptoError(
            "age_keygen_timeout", "La generación de la clave de cifrado excedió el tiempo."
        ) from error
    if result.returncode != 0:
        raise BackupCryptoError(
            "age_keygen_failed", "No se pudo generar la clave de cifrado."
        )

    # Salida de age-keygen: comentarios (# created / # public key: age1...) y la
    # identidad AGE-SECRET-KEY-1... en su propia línea. stderr también anuncia la
    # pública en versiones recientes; se parsea stdout que es estable.
    recipient = ""
    identity = ""
    for line in result.stdout.splitlines():
        stripped = line.strip()
        if stripped.startswith("# public key:"):
            recipient = stripped.removeprefix("# public key:").strip()
        elif stripped.startswith("AGE-SECRET-KEY-"):
            identity = stripped
    if not recipient or not identity:
        raise BackupCryptoError(
            "age_keygen_unparseable", "La salida de age-keygen no tuvo la forma esperada."
        )
    return recipient, identity


def sha256_of_file(path: Path) -> str:
    """SHA-256 (hex) de un archivo, en streaming (los respaldos pueden ser grandes)."""
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()
