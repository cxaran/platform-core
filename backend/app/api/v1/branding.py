"""Marca PÚBLICA de la instalación (manifest de la PWA, favicon, login).

Endpoints SIN autenticación por diseño: el manifest lo genera el frontend en el
servidor (sin cookie) y el navegador pide los íconos al instalar la PWA. Solo se
expone contenido NO sensible: nombre visible, si hay logo y el binario del logo
(imagen raster verificada al subir; SVG bloqueado — nunca se sirve markup).
"""

from typing import Optional

from fastapi import APIRouter, Query, Request, Response, status

from backend.app.api.resource_actions import api_error
from backend.app.core.database import SessionDep
from backend.app.schemas.base import ApiSchema
from backend.app.services.pwa_icon_service import IconRenderError, build_square_icon
from backend.app.services.system_settings_service import (
    get_system_settings,
    project_display_name,
)

router = APIRouter(prefix="/public/branding", tags=["public"])


class PublicBranding(ApiSchema):
    """Marca pública: lo mínimo para el manifest y los encabezados."""

    name: str
    has_logo: bool
    # Cache-buster del manifest/íconos: cambia con cada reemplazo del logo.
    logo_version: Optional[str] = None


@router.get("", response_model=PublicBranding)
def read_public_branding(session: SessionDep, response: Response) -> PublicBranding:
    row = get_system_settings(session)
    has_logo = row.brand_logo_content is not None
    response.headers["Cache-Control"] = "public, max-age=60"
    return PublicBranding(
        name=project_display_name(session),
        has_logo=has_logo,
        logo_version=(
            row.brand_logo_updated_at.isoformat() if has_logo and row.brand_logo_updated_at else None
        ),
    )


@router.get("/logo")
@router.head("/logo")
def read_public_logo(session: SessionDep, request: Request) -> Response:
    """El logo original (raster verificado). HEAD permite al frontend comprobar
    el content-type antes de referenciarlo como favicon."""
    row = get_system_settings(session)
    if row.brand_logo_content is None or not row.brand_logo_mime:
        api_error(status.HTTP_404_NOT_FOUND, "sin_logo", "La instalación no tiene logo.")
    return Response(
        content=b"" if request.method == "HEAD" else row.brand_logo_content,
        media_type=row.brand_logo_mime,
        headers={
            "Cache-Control": "public, max-age=3600",
            "X-Content-Type-Options": "nosniff",
        },
    )


@router.get("/pwa-icon")
def read_pwa_icon(
    session: SessionDep,
    size: int = Query(default=512, ge=48, le=1024),
    bg: str = Query(default="transparent", max_length=16),
    padding: float = Query(default=0.0, ge=0.0, le=0.45),
    v: Optional[str] = Query(default=None, max_length=64),  # cache-buster del manifest
) -> Response:
    """Ícono CUADRADO de la PWA derivado del logo, generado al vuelo.

    Centra el logo (sin deformar) en un lienzo cuadrado con márgenes
    transparentes (o el color ``bg``) y lo escala a ``size``. ``padding`` reserva
    la zona segura del ícono adaptable de Android (maskable). 404 si no hay logo
    o no es una imagen legible → el manifest cae al ícono placeholder.
    """
    row = get_system_settings(session)
    if row.brand_logo_content is None:
        api_error(status.HTTP_404_NOT_FOUND, "sin_logo", "La instalación no tiene logo.")
    try:
        png = build_square_icon(
            row.brand_logo_content, size=size, background=bg, padding=padding
        )
    except IconRenderError:
        api_error(
            status.HTTP_404_NOT_FOUND, "logo_no_renderizable", "El logo no es una imagen válida."
        )
    return Response(
        content=png,
        media_type="image/png",
        headers={
            "Cache-Control": "public, max-age=86400",
            "X-Content-Type-Options": "nosniff",
        },
    )
