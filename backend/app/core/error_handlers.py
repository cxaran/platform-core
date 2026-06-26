"""Registra handlers globales que unifican el cuerpo de error de la API."""

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


def _spanish_validation_message(error: dict[str, Any]) -> str:
    """Traduce un error estructurado de Pydantic/FastAPI a un mensaje UX en español.

    El backend sigue siendo la autoridad: solo se mapean *tipos estándar* conocidos
    a partir de su ``ctx`` (constraints declaradas). Los mensajes de dominio (de
    validadores ``ValueError``) ya vienen en español y se preservan. Los tipos
    desconocidos usan un mensaje general seguro, sin filtrar texto interno en inglés.
    """
    error_type = str(error.get("type", ""))
    ctx = error.get("ctx") or {}

    if error_type == "missing":
        return "Este campo es obligatorio."
    if error_type == "string_too_short":
        minimum = ctx.get("min_length")
        return (
            f"Debe tener al menos {minimum} caracteres."
            if minimum is not None
            else "El valor es demasiado corto."
        )
    if error_type == "string_too_long":
        maximum = ctx.get("max_length")
        return (
            f"Debe tener como máximo {maximum} caracteres."
            if maximum is not None
            else "El valor es demasiado largo."
        )
    if error_type == "greater_than_equal":
        return f"Debe ser mayor o igual a {ctx.get('ge')}."
    if error_type == "less_than_equal":
        return f"Debe ser menor o igual a {ctx.get('le')}."
    if error_type == "greater_than":
        return f"Debe ser mayor que {ctx.get('gt')}."
    if error_type == "less_than":
        return f"Debe ser menor que {ctx.get('lt')}."
    if error_type == "value_error":
        cleaned = str(error.get("msg", "")).removeprefix("Value error, ").strip()
        if "valid email address" in cleaned.lower():
            return "Correo electrónico inválido."
        return cleaned or "El valor ingresado no es válido."
    return "El valor ingresado no es válido."


async def _validation_error_handler(_: Request, exc: Exception) -> JSONResponse:
    assert isinstance(exc, RequestValidationError)
    errors = [
        ErrorItem(
            field=_field_from_loc(error["loc"]),
            message=_spanish_validation_message(error),
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
