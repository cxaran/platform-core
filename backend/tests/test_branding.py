"""Marca de la instalación: endpoints públicos de branding y logo de la PWA.

Cubre: branding público (nombre + has_logo), 404 sin logo, subida verificada con
Pillow (PNG real acepta; no-imagen y tamaño excesivo rechazan), render del ícono
cuadrado, borrado, y el gate de permisos del upload.
"""

import io
import os
import unittest
import uuid


DEV_ENV = {
    "ENVIRONMENT": "local",
    "SECRET_KEY": "test-secret-key",
    "ACCESS_TOKEN_EXPIRE_MINUTES": "30",
    "EMAIL_TOKEN_EXPIRE_MINUTES": "30",
    "TRYS_BEFORE_LOCK": "5",
    "REDIS_HOST": "redis",
    "REDIS_PORT": "6379",
    "REDIS_DB": "0",
    "SMTP_HOST": "mailpit",
    "SMTP_PORT": "1025",
    "SMTP_USER": "test@example.com",
    "SMTP_PASSWORD": "test-password",
    "SMTP_FROM_EMAIL": "test@example.com",
    "SMTP_FROM_NAME": "Platform Core Test",
    "SMTP_TLS": "false",
    "SMTP_SSL": "false",
    "SMTP_USE_CREDENTIALS": "false",
    "POSTGRES_USER": "platform",
    "POSTGRES_PASSWORD": "platform",
    "POSTGRES_SERVER": "postgres",
    "POSTGRES_PORT": "5432",
    "POSTGRES_DB": "platform_core",
}

os.environ.update(DEV_ENV)

from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import create_engine  # noqa: E402
from sqlalchemy.pool import StaticPool  # noqa: E402
from sqlmodel import Session  # noqa: E402

from backend.app.auth.auth_dependencies import get_current_user  # noqa: E402
from backend.app.core.database import get_db  # noqa: E402
from backend.app.main import app  # noqa: E402
from backend.app.models import Base  # noqa: E402
from backend.app.models.system_settings import SystemSettings  # noqa: E402
from backend.app.schemas.user import SessionUser  # noqa: E402
from backend.app.services.pwa_icon_service import IconRenderError, build_square_icon  # noqa: E402


def _png_bytes(width: int = 30, height: int = 10) -> bytes:
    from PIL import Image

    image = Image.new("RGBA", (width, height), (10, 20, 30, 255))
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()


class BuildSquareIconTest(unittest.TestCase):
    def test_squares_and_centers_without_deforming(self) -> None:
        from PIL import Image

        png = build_square_icon(_png_bytes(30, 10), size=64)
        with Image.open(io.BytesIO(png)) as icon:
            self.assertEqual(icon.size, (64, 64))
            self.assertEqual(icon.format, "PNG")
            # Márgenes transparentes arriba/abajo (el logo es apaisado).
            self.assertEqual(icon.convert("RGBA").getpixel((32, 1))[3], 0)

    def test_rejects_non_image(self) -> None:
        with self.assertRaises(IconRenderError):
            build_square_icon(b"<svg>no soy raster</svg>", size=64)


class BrandingEndpointsTest(unittest.TestCase):
    def setUp(self) -> None:
        self.engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(self.engine)
        with Session(self.engine) as session:
            session.add(SystemSettings(institution_name="Clínica Aurora"))
            session.commit()

        def override_db():
            with Session(self.engine) as session:
                yield session

        app.dependency_overrides[get_db] = override_db
        self._as("system_settings:read", "system_settings:configure")
        self.client = TestClient(app)

    def tearDown(self) -> None:
        app.dependency_overrides.clear()

    def _as(self, *permissions: str) -> None:
        app.dependency_overrides[get_current_user] = lambda: SessionUser(
            id=uuid.uuid4(),
            name="Admin",
            last_name="Sistema",
            email="admin@example.com",
            permissions=set(permissions),
        )

    def _settings_id(self) -> str:
        page = self.client.get("/api/v1/system-settings")
        self.assertEqual(page.status_code, 200, page.text)
        return page.json()["items"][0]["id"]

    def test_public_branding_without_logo(self) -> None:
        response = self.client.get("/api/v1/public/branding")
        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        self.assertEqual(body["name"], "Clínica Aurora")
        self.assertFalse(body["has_logo"])
        self.assertEqual(self.client.get("/api/v1/public/branding/logo").status_code, 404)
        self.assertEqual(self.client.get("/api/v1/public/branding/pwa-icon").status_code, 404)

    def test_upload_render_and_delete_logo(self) -> None:
        item_id = self._settings_id()
        upload = self.client.put(
            f"/api/v1/system-settings/{item_id}/logo",
            files={"file": ("logo.png", _png_bytes(), "image/png")},
        )
        self.assertEqual(upload.status_code, 200, upload.text)
        self.assertTrue(upload.json()["brand_logo_configured"])

        branding = self.client.get("/api/v1/public/branding").json()
        self.assertTrue(branding["has_logo"])
        self.assertIsNotNone(branding["logo_version"])

        logo = self.client.get("/api/v1/public/branding/logo")
        self.assertEqual(logo.status_code, 200)
        self.assertEqual(logo.headers["content-type"], "image/png")

        icon = self.client.get("/api/v1/public/branding/pwa-icon?size=96")
        self.assertEqual(icon.status_code, 200)
        self.assertEqual(icon.headers["content-type"], "image/png")

        removed = self.client.delete(f"/api/v1/system-settings/{item_id}/logo")
        self.assertEqual(removed.status_code, 200, removed.text)
        self.assertFalse(removed.json()["brand_logo_configured"])
        self.assertEqual(self.client.get("/api/v1/public/branding/pwa-icon").status_code, 404)

    def test_upload_rejects_non_raster_content(self) -> None:
        item_id = self._settings_id()
        # Content-type miente (dice PNG) pero el CONTENIDO es SVG: se rechaza.
        response = self.client.put(
            f"/api/v1/system-settings/{item_id}/logo",
            files={"file": ("logo.png", b"<svg xmlns='x'></svg>", "image/png")},
        )
        self.assertEqual(response.status_code, 422, response.text)
        self.assertEqual(response.json()["code"], "logo_formato_invalido")

    def test_upload_rejects_oversized_file(self) -> None:
        item_id = self._settings_id()
        big = b"\x89PNG" + b"0" * (2 * 1024 * 1024 + 1)
        response = self.client.put(
            f"/api/v1/system-settings/{item_id}/logo",
            files={"file": ("logo.png", big, "image/png")},
        )
        self.assertEqual(response.status_code, 413, response.text)

    def test_upload_requires_configure_permission(self) -> None:
        item_id = self._settings_id()
        self._as("system_settings:read")  # sin configure
        response = self.client.put(
            f"/api/v1/system-settings/{item_id}/logo",
            files={"file": ("logo.png", _png_bytes(), "image/png")},
        )
        self.assertEqual(response.status_code, 403, response.text)


if __name__ == "__main__":
    unittest.main()
