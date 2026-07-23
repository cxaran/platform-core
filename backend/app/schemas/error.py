from pydantic import BaseModel


class ErrorItem(BaseModel):
    """Detalle de un error asociado a un campo concreto.

    ``type``/``ctx`` exponen el error estructurado de Pydantic (p. ej.
    ``string_too_short`` + ``{"min_length": 4}``) para que el frontend construya
    el mensaje UX; ``message`` conserva el texto crudo (los mensajes de dominio
    de validadores ``ValueError`` ya vienen en español y se usan tal cual).
    """

    field: str | None = None
    message: str
    type: str | None = None
    ctx: dict[str, str | int | float | bool] | None = None


class ErrorResponse(BaseModel):
    """Envelope de error estándar para toda la API."""

    code: str
    message: str
    errors: list[ErrorItem] | None = None
