"""Contrato HTTP público de capabilities (Commit 3).

Describe, por recurso navegable y filtrado por el usuario actual, qué puede
presentar el frontend: columnas de lista, paginación/búsqueda/orden, formularios
de creación/actualización y acciones permitidas.

Reglas del contrato:
- Los tipos de valor, widgets, métodos HTTP, scope y view son ``Enum`` (no ``str``
  libre).
- Nunca se serializan permisos, ``SecurityControl``, expresiones SQLAlchemy,
  bindings de columnas, ``orderable_columns``, ``tie_breakers`` ni PK internas.
- ``create``/``update`` no autorizados se omiten (``None`` + ``response_model_exclude_none``),
  nunca ``allowed: false``. ``actions`` solo contiene acciones permitidas.
"""

from enum import Enum
from typing import Any, Optional

from pydantic import Field

from backend.app.schemas.base import ApiReadSchema


class FieldValueType(str, Enum):
    STRING = "string"
    EMAIL = "email"
    UUID = "uuid"
    INTEGER = "integer"
    DECIMAL = "decimal"
    BOOLEAN = "boolean"
    DATE = "date"
    DATETIME = "datetime"
    ENUM = "enum"
    ARRAY = "array"


class WidgetType(str, Enum):
    TEXT = "text"
    EMAIL = "email"
    PASSWORD = "password"
    SWITCH = "switch"
    TEXTAREA = "textarea"
    MULTISELECT = "multiselect"
    SELECT = "select"
    # Controles de fecha de calendario (filtros de fecha de C1). El frontend envía un
    # literal ``YYYY-MM-DD`` (nunca ``new Date()``/``toISOString()``).
    DATE = "date"
    DATERANGE = "daterange"


class FilterOperator(str, Enum):
    EQ = "eq"
    NE = "ne"
    CONTAINS = "contains"
    STARTS_WITH = "starts_with"
    ENDS_WITH = "ends_with"
    GTE = "gte"
    LTE = "lte"
    ON = "on"
    BEFORE = "before"
    AFTER = "after"
    BETWEEN = "between"
    IN = "in"
    ISNULL = "isnull"


class FilterValueShape(str, Enum):
    # Un solo valor (texto, fecha, opción).
    SINGLE = "single"
    # Rango con dos extremos declarados en ``parameters`` (p. ej. ``between``).
    RANGE = "range"
    # Múltiples valores (p. ej. ``in``).
    MULTIPLE = "multiple"
    # Sin valor (p. ej. ``isnull``): el operador es la condición.
    NONE = "none"


class HttpMethod(str, Enum):
    GET = "GET"
    POST = "POST"
    PATCH = "PATCH"
    PUT = "PUT"
    DELETE = "DELETE"


class ActionScope(str, Enum):
    RESOURCE = "resource"
    ITEM = "item"


class ResourceView(str, Enum):
    TABLE = "table"
    GROUPED_CATALOG = "grouped_catalog"


class RelationCardinality(str, Enum):
    MULTIPLE = "multiple"


class OptionsSourceType(str, Enum):
    # Endpoint de lista paginada (p. ej. roles): cada item lleva value y label.
    LIST = "list"
    # Catálogo agrupado (p. ej. permisos): grupos con permisos que llevan value y label.
    GROUPED_CATALOG = "grouped_catalog"


class ResourceFieldCapability(ApiReadSchema):
    name: str
    label: str
    description: Optional[str] = None
    type: FieldValueType
    visible_in_list: bool
    sortable: bool
    searchable: bool
    # Capacidad técnica de lectura (qué operadores admite el campo en el plan). Los
    # controles de filtro *visibles* se declaran en ``ResourceListCapability.filters``.
    filter_operators: list[FilterOperator]


class ResourceFilterOption(ApiReadSchema):
    value: str
    label: str


class ResourceFilterCapability(ApiReadSchema):
    field: str
    parameter: str
    operator: FilterOperator
    label: str
    description: Optional[str] = None
    type: FieldValueType
    widget: WidgetType
    options: Optional[list[ResourceFilterOption]] = None


class FilterableRangeParameters(ApiReadSchema):
    """Nombres de parámetro de los dos extremos de un operador de rango (``between``)."""

    # ``from`` es palabra reservada en Python: se publica con alias.
    from_: str = Field(alias="from")
    to: str


class FilterableOperatorCapability(ApiReadSchema):
    """Un operador concreto que un campo expone como filtro visible.

    ``parameter_name`` (operadores de un solo parámetro) y ``parameters`` (rango) son
    mutuamente excluyentes. ``value_shape`` indica cómo capturar el valor; ``widget``,
    cómo renderizarlo. Los flags opcionales describen la semántica que el frontend debe
    respetar pero no inferir (case-sensitivity, zona horaria de calendario, inclusión
    del extremo superior del rango, multiplicidad)."""

    key: FilterOperator
    label: str
    value_shape: FilterValueShape
    widget: WidgetType
    parameter_name: Optional[str] = None
    parameters: Optional[FilterableRangeParameters] = None
    case_sensitive: Optional[bool] = None
    calendar_timezone: Optional[str] = None
    range_end_inclusive: Optional[bool] = None
    multiple: Optional[bool] = None
    options: Optional[list[ResourceFilterOption]] = None
    max_values: Optional[int] = None
    placeholder: Optional[str] = None


class FilterableFieldCapability(ApiReadSchema):
    """Campo filtrable y los operadores que expone (contrato visible de filtros).

    Fuente declarativa única: los operadores se derivan del plan compilado del recurso
    (``QueryOptions``/``field_operators``); el frontend no infiere parámetros ni sufijos."""

    key: str
    label: str
    description: Optional[str] = None
    value_type: FieldValueType
    operators: list[FilterableOperatorCapability]


class PaginationCapability(ApiReadSchema):
    default_limit: int
    max_limit: int


class SearchCapability(ApiReadSchema):
    enabled: bool
    min_length: Optional[int] = None
    max_length: Optional[int] = None


class SortCapability(ApiReadSchema):
    default_sort: Optional[str] = None
    fixed_server_order: bool
    max_terms: int
    max_length: int


class ResourceListCapability(ApiReadSchema):
    fields: list[ResourceFieldCapability]
    # Filtros visibles heredados (un control por campo). Se conserva por compatibilidad;
    # el contrato completo y declarativo de filtros vive en ``filterable_fields``.
    filters: list[ResourceFilterCapability] = []
    # Contrato aditivo de filtros declarativos (C1): por campo, los operadores que
    # expone con su forma de valor, widget y parámetros.
    filterable_fields: list[FilterableFieldCapability] = []
    pagination: PaginationCapability
    search: SearchCapability
    sort: SortCapability


class ResourceFormFieldCapability(ApiReadSchema):
    name: str
    label: str
    description: Optional[str] = None
    type: FieldValueType
    required: bool
    # ``editable=False`` describe un campo presente en el formulario pero no
    # modificable (se omite del payload). Hoy todos los campos declarados son
    # editables; el indicador deja el contrato preparado para campos de solo lectura.
    editable: bool = True
    widget: Optional[WidgetType] = None


class ResourceFormCapability(ApiReadSchema):
    method: HttpMethod
    url_template: str
    fields: list[ResourceFormFieldCapability]


class ResourceFormsCapability(ApiReadSchema):
    create: Optional[ResourceFormCapability] = None
    update: Optional[ResourceFormCapability] = None


class ActionSuccessBehavior(str, Enum):
    # Tras el éxito, refrescar el listado actual (re-fetch del Server Component).
    REFRESH = "refresh"


class ActionRequestSpec(ApiReadSchema):
    """Cuerpo fijo declarado por backend para una acción.

    El frontend envía exactamente ``fixed_body`` (o vacío si no hay request): no
    puede agregar, quitar ni modificar campos, ni reutilizar la acción para otro
    payload."""

    content_type: str
    fixed_body: dict[str, Any]


class ActionConfirmation(ApiReadSchema):
    required: bool
    title: str
    message: str
    confirm_label: str
    destructive: bool


class ResourceActionCapability(ApiReadSchema):
    name: str
    label: str
    method: HttpMethod
    url_template: str
    scope: ActionScope
    danger: bool
    request: Optional[ActionRequestSpec] = None
    confirmation: Optional[ActionConfirmation] = None
    success_behavior: ActionSuccessBehavior = ActionSuccessBehavior.REFRESH


class RelationOptionsSource(ApiReadSchema):
    """Origen declarado del universo de opciones de un editor relacional."""

    type: OptionsSourceType
    url: str
    value_field: str
    label_field: str


class ResourceRelationCapability(ApiReadSchema):
    """Editor relacional declarado por el backend (p. ej. roles de un usuario).

    El frontend no infiere rutas ni cardinalidad desde nombres: consume estas URLs
    y campos. ``selection_url`` y ``mutation_url`` son plantillas con ``{id}`` del
    recurso dueño. ``request_field`` es el campo del cuerpo que transporta la lista
    completa de valores objetivo (reemplazo atómico)."""

    name: str
    label: str
    description: Optional[str] = None
    cardinality: RelationCardinality
    required: bool
    editable: bool
    selection_url: str
    # Campo de la respuesta de ``selection_url`` con la lista de valores actuales.
    # Ausente cuando la selección es una página (``items[]``) y el valor se lee con
    # ``options.value_field``.
    selection_field: Optional[str] = None
    mutation_method: HttpMethod
    mutation_url: str
    request_field: str
    options: RelationOptionsSource


class ItemReference(ApiReadSchema):
    """Referencia pública y estable de un item de listado.

    No se llama ``primary_key`` ni expone bindings ORM: declara qué campo de cada
    item identifica el recurso (``field``), qué token usan las plantillas de URL
    (``placeholder``, p. ej. ``{id}``) y su tipo. El frontend nunca asume ``id``."""

    field: str
    placeholder: str
    type: FieldValueType


class ResourceDetailCapability(ApiReadSchema):
    """Lectura individual declarada de un recurso (precarga de formularios)."""

    method: HttpMethod
    url_template: str


class ResourceCapability(ApiReadSchema):
    name: str
    label: str
    api_path: str
    view: ResourceView
    item_reference: Optional[ItemReference] = None
    detail: Optional[ResourceDetailCapability] = None
    # El atributo se llama ``list_`` para no sombrear el builtin ``list`` dentro del
    # cuerpo de la clase; se serializa/valida como ``list`` vía alias.
    list_: Optional[ResourceListCapability] = Field(default=None, alias="list")
    forms: Optional[ResourceFormsCapability] = None
    actions: list[ResourceActionCapability] = []
    relations: list[ResourceRelationCapability] = []
