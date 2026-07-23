"""Registra handlers globales que unifican el cuerpo de error de la API.

Los errores de validación viajan estructurados (``type`` + ``ctx`` por campo);
la traducción a mensajes UX en español vive en el frontend
(``src/core/api/validation-messages.ts``), aplicada en todas las llamadas.
"""

from typing import Any, Sequence

from fastapi import FastAPI, HTTPException, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from backend.app.query.validation import QueryParameterError
from backend.app.schemas.error import ErrorItem, ErrorResponse

_IGNORED_LOC_PREFIXES = {"query", "body", "path", "header", "cookie"}


def _error_response(
    status_code: int,
    code: str,
    message: str,
    errors: list[ErrorItem] | None = None,
) -> JSONResponse:
    body = ErrorResponse(code=code, message=message, errors=errors)
    return JSONResponse(status_code=status_code, content=body.model_dump(exclude_none=True))


def _field_from_loc(loc: Sequence[Any]) -> str | None:
    parts = [str(part) for part in loc if part not in _IGNORED_LOC_PREFIXES]
    return ".".join(parts) if parts else None


async def _query_parameter_error_handler(_: Request, exc: Exception) -> JSONResponse:
    assert isinstance(exc, QueryParameterError)
    errors = [ErrorItem(field=exc.field_name, message=exc.message)] if exc.field_name else None
    return _error_response(status.HTTP_422_UNPROCESSABLE_CONTENT, exc.code, exc.message, errors)


def _public_ctx(ctx: Any) -> dict[str, str | int | float | bool] | None:
    """Constraints declaradas del error (min_length, ge, ...), solo primitivos."""
    if not isinstance(ctx, dict):
        return None
    public = {
        str(key): value
        for key, value in ctx.items()
        if isinstance(value, (str, int, float, bool))
    }
    return public or None


async def _validation_error_handler(_: Request, exc: Exception) -> JSONResponse:
    assert isinstance(exc, RequestValidationError)
    errors = [
        ErrorItem(
            field=_field_from_loc(error["loc"]),
            message=str(error.get("msg", "")),
            type=str(error.get("type", "")) or None,
            ctx=_public_ctx(error.get("ctx")),
        )
        for error in exc.errors()
    ]
    return _error_response(
        status.HTTP_422_UNPROCESSABLE_CONTENT,
        code="validation_error",
        message="Parámetros inválidos",
        errors=errors,
    )


async def _http_exception_handler(_: Request, exc: Exception) -> JSONResponse:
    assert isinstance(exc, HTTPException)
    if isinstance(exc.detail, dict) and "code" in exc.detail and "message" in exc.detail:
        return JSONResponse(
            status_code=exc.status_code,
            content=exc.detail,
            headers=exc.headers,
        )
    return _error_response(
        exc.status_code,
        code=f"http_{exc.status_code}",
        message=str(exc.detail),
    )


def register_exception_handlers(app: FastAPI) -> None:
    app.add_exception_handler(HTTPException, _http_exception_handler)
    app.add_exception_handler(QueryParameterError, _query_parameter_error_handler)
    app.add_exception_handler(RequestValidationError, _validation_error_handler)
