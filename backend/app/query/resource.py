"""``ResourceQuery``: fachada de compatibilidad sobre ``ListQueryContract``.

Conserva exactamente el constructor, ``.Query`` y ``.paginate()`` que ya usan los
callers existentes (``api/v1/roles.py``, ``api/v1/users_admin.py``,
``api/resource_actions.py``). Internamente delega en ``ListQueryContract``, que
pasa el plan explícito al motor. La API nueva es ``ListQueryContract``.
"""

from typing import Any, Generic, TypeVar

from pydantic import BaseModel
from sqlalchemy import Select
from sqlalchemy.orm import Session

from backend.app.query.contracts import ListQueryContract
from backend.app.query.options import QueryOptions
from backend.app.query.schema import OffsetQuerySchema
from backend.app.schemas.pagination import OffsetPage

TItem = TypeVar("TItem", bound=BaseModel)


class ResourceQuery(Generic[TItem]):
    """Fachada heredada. Para recursos nuevos prefiera ``ListQueryContract``.

    Ejemplo::

        USERS = ResourceQuery(
            name="UserQuery",
            model=User,
            schema=UserRead,
            options=QueryOptions(search_fields=("name", "email")),
        )

        @router.get("", response_model=OffsetPage[UserRead])
        def list_users(
            session: SessionDep,
            query: Annotated[USERS.Query, Query()],
            _: UserPermissions.READ.requiere,
        ) -> OffsetPage[UserRead]:
            return USERS.paginate(session, query)
    """

    def __init__(
        self,
        *,
        name: str,
        model: type[Any],
        schema: type[TItem],
        options: QueryOptions | None = None,
    ) -> None:
        # La fachada heredada siempre opera por ``options`` (default vacío si se
        # omite), de modo que el contrato recibe exactamente una fuente.
        self._contract: ListQueryContract[TItem] = ListQueryContract(
            name=name,
            model=model,
            schema=schema,
            options=options if options is not None else QueryOptions(),
        )
        self.model = model
        self.schema = schema
        self.Query: type[OffsetQuerySchema] = self._contract.Query

    def paginate(
        self,
        session: Session,
        query: OffsetQuerySchema,
        *,
        stmt: Select[Any] | None = None,
    ) -> OffsetPage[TItem]:
        """Pagina el recurso. Por defecto consulta ``select(model)``; se puede
        pasar un ``stmt`` propio (p. ej. con joins o filtros de tenant)."""
        return self._contract.paginate(session, query, stmt=stmt)
