"""Bases técnicas de Pydantic para todos los schemas de la API.

Estas clases estandarizan únicamente el *comportamiento* de Pydantic (config,
lectura desde ORM, rechazo de campos no declarados). No contienen campos de
negocio: para compartir campos de dominio use un ``XBase`` específico del
recurso.

Convención de nombres por recurso (ver CLAUDE.md):

    XBase            Fragmento reusable de campos de dominio (opcional).
    XCreate          Entrada de creación (POST).        -> ApiWriteSchema
    XRead            Representación pública completa.    -> ApiReadSchema
    XListItem        Versión reducida para listados.     -> ApiReadSchema
    XUpdate          Actualización parcial (PATCH).      -> ApiPatchSchema
    XReplace         Reemplazo completo (PUT).           -> ApiWriteSchema
    XQuery           Filtros/búsqueda/orden/paginación.  -> OffsetQuerySchema (query/schema.py)
    XDeleteResult    Resultado de DELETE (si no es 204).
    X<Action>Request / X<Action>Result   Acciones no-CRUD.
"""

from pydantic import BaseModel, ConfigDict


class ApiSchema(BaseModel):
    """Raíz técnica común a entrada y salida."""

    model_config = ConfigDict(
        populate_by_name=True,
        str_strip_whitespace=True,
    )


class ApiReadSchema(ApiSchema):
    """Base para schemas de salida (``XRead``/``XListItem``).

    Permite validar directamente desde instancias ORM (``from_attributes``).
    """

    model_config = ConfigDict(
        populate_by_name=True,
        str_strip_whitespace=True,
        from_attributes=True,
    )


class ApiWriteSchema(ApiSchema):
    """Base para schemas de entrada total (``XCreate``/``XReplace``).

    Rechaza campos no declarados (``extra="forbid"``): lo que no se declara
    permanece prohibido.
    """

    model_config = ConfigDict(
        populate_by_name=True,
        str_strip_whitespace=True,
        extra="forbid",
    )


class ApiPatchSchema(ApiWriteSchema):
    """Base para actualización parcial (``XUpdate``, PATCH).

    Convención: todos los campos se declaran ``Optional`` con default ``None`` y
    el endpoint consume solo los enviados con ``model.model_dump(exclude_unset=True)``.
    """
