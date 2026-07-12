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
from typing import Any, Literal, Optional

from pydantic import Field, model_validator

from backend.app.schemas.base import ApiReadSchema


class FieldValueType(str, Enum):
    STRING = "string"
    EMAIL = "email"
    UUID = "uuid"
    INTEGER = "integer"
    DECIMAL = "decimal"
    BOOLEAN = "boolean"
    DATE = "date"
    TIME = "time"
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
    NUMBER = "number"
    # Controles de fecha de calendario (filtros de fecha de C1). El frontend envía un
    # literal ``YYYY-MM-DD`` (nunca ``new Date()``/``toISOString()``).
    DATE = "date"
    DATERANGE = "daterange"
    DATETIME = "datetime"
    TIME = "time"


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
    # Nota: "multiple" y "none" se retiraron — los operadores in/isnull están
    # excluidos a propósito del contrato filtrable visible, así que esas formas
    # eran inalcanzables y obligaban al frontend a narrowing de casos imposibles.


class HttpMethod(str, Enum):
    GET = "GET"
    POST = "POST"
    PATCH = "PATCH"
    PUT = "PUT"
    DELETE = "DELETE"


class ActionScope(str, Enum):
    # Sólo acciones por ITEM: el valor "resource" (acciones a nivel de recurso) se
    # retiró — ningún recurso lo producía y el frontend no tenía render para él
    # (habría sido un botón fantasma). Si algún día hace falta, se construye con
    # su superficie de UI a la par.
    ITEM = "item"


class ResourceView(str, Enum):
    TABLE = "table"
    GROUPED_CATALOG = "grouped_catalog"



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
    # Contrato declarativo ÚNICO de filtros: por campo, los operadores que expone con
    # su forma de valor, widget y parámetros. (El contrato legacy ``filters`` se
    # retiró: derivaba solo de ui.filter manual y dejaba al copiloto sin los
    # operadores automáticos del plan.)
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
    # Opciones cerradas de un campo de selección (enum o ``ui.options``), con la misma
    # forma ``{value, label}`` que los filtros. ``None`` cuando el campo no declara un
    # universo de opciones (texto libre, número, fecha, etc.). El ``value`` se serializa
    # como string aunque el tipo real sea entero/booleano (misma convención que filtros).
    options: Optional[list[ResourceFilterOption]] = None


class FormTransport(str, Enum):
    # Cuerpo JSON estándar (default, retrocompatible).
    JSON = "json"
    # ``multipart/form-data``: el formulario incluye un archivo. El frontend NO debe
    # enviar JSON; los campos de metadata viajan como campos de formulario y el binario
    # en ``file_field``.
    MULTIPART = "multipart"


class ResourceFileFieldCapability(ApiReadSchema):
    """Campo de archivo de un formulario multipart (genérico, sin semántica de dominio).

    El frontend usa ``accepted_mime_types`` y ``max_size_bytes`` solo como guía de UI; el
    backend revalida tamaño y tipo en cada carga."""

    name: str
    label: str
    accepted_mime_types: list[str]
    max_size_bytes: int
    required: bool


class ResourceFormCapability(ApiReadSchema):
    method: HttpMethod
    url_template: str
    fields: list[ResourceFormFieldCapability]
    # ``transport``/``file_field`` describen un formulario con carga de archivo. Para los
    # formularios JSON normales ``transport`` es ``json`` y ``file_field`` se omite.
    transport: FormTransport = FormTransport.JSON
    file_field: Optional[ResourceFileFieldCapability] = None


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


class ActionInputSchema(ApiReadSchema):
    """Formulario declarado de entrada de una acción (B2).

    Sólo se publica cuando la acción declara un ``input_schema`` (en vez de un cuerpo
    fijo). Reusa exactamente la misma proyección de formularios que ``create``/``update``:
    cada campo es un ``ResourceFormFieldCapability`` (label, tipo, widget, obligatoriedad
    y opciones). Nunca se serializan defaults, validadores ni la clase Python."""

    fields: list[ResourceFormFieldCapability]


class ActionConditionOperator(str, Enum):
    """Operadores del DSL serializable de condiciones (``visible_when``/``enabled_when``).

    Es un contrato de datos, no un lenguaje evaluable: nunca se publican expresiones,
    JavaScript, Python ni lambdas."""

    EQ = "eq"
    NEQ = "neq"
    IN = "in"
    NOT_IN = "not_in"
    IS_NULL = "is_null"
    NOT_NULL = "not_null"


class ActionConditionPredicate(ApiReadSchema):
    """Predicado atómico: compara el campo ``field`` del item con ``value``.

    ``value`` es escalar para ``eq``/``neq``, una lista para ``in``/``not_in`` y se
    omite para ``is_null``/``not_null``. La validez se comprueba al construir el
    predicado (en el registro de la acción), no al evaluarlo."""

    field: str
    operator: ActionConditionOperator
    value: Optional[Any] = None

    @model_validator(mode="after")
    def _validate_shape(self) -> "ActionConditionPredicate":
        if not self.field or not self.field.strip():
            raise ValueError("El predicado de condición requiere un 'field' no vacío.")
        op = self.operator
        if op in (ActionConditionOperator.EQ, ActionConditionOperator.NEQ):
            if self.value is None:
                raise ValueError(
                    f"El operador '{op.value}' requiere un 'value'."
                )
        elif op in (ActionConditionOperator.IN, ActionConditionOperator.NOT_IN):
            if not isinstance(self.value, list) or len(self.value) == 0:
                raise ValueError(
                    f"El operador '{op.value}' requiere un 'value' de lista no vacía."
                )
        else:  # is_null / not_null
            if self.value is not None:
                raise ValueError(
                    f"El operador '{op.value}' no admite 'value'."
                )
        return self


class ActionCondition(ApiReadSchema):
    """Condición de estado de una acción: conjunción (``all``) de predicados.

    Sólo se soporta ``all`` (todos los predicados deben cumplirse). El permiso es una
    propiedad aparte (``permission`` en el registro) y nunca se expresa aquí. El backend
    sigue siendo la autoridad final: si el frontend no puede evaluar la condición, debe
    comportarse de forma conservadora."""

    # ``all`` es builtin de Python: el atributo se llama ``all_`` y se serializa/valida
    # como ``all`` vía alias (con ``populate_by_name`` se construye con cualquiera).
    all_: list[ActionConditionPredicate] = Field(alias="all")

    @model_validator(mode="after")
    def _validate_non_empty(self) -> "ActionCondition":
        if not self.all_:
            raise ValueError("La condición 'all' no puede estar vacía.")
        return self


class ResourceActionCapability(ApiReadSchema):
    name: str
    label: str
    method: HttpMethod
    url_template: str
    scope: ActionScope
    danger: bool
    request: Optional[ActionRequestSpec] = None
    # Formulario de entrada (B2). Excluyente con ``request``: una acción declara un
    # cuerpo fijo o un formulario, nunca ambos.
    input_schema: Optional[ActionInputSchema] = None
    confirmation: Optional[ActionConfirmation] = None
    success_behavior: ActionSuccessBehavior = ActionSuccessBehavior.REFRESH
    # Condiciones de estado (B3). ``visible_when``: si no se cumple, la acción no se
    # muestra. ``enabled_when``: si no se cumple, se muestra deshabilitada. Ambas son el
    # DSL serializable; el permiso se filtra antes (la acción ni siquiera se proyecta).
    visible_when: Optional[ActionCondition] = None
    enabled_when: Optional[ActionCondition] = None


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


class ResourceFileDownloadCapability(ApiReadSchema):
    """Descarga de contenido binario de un item (navegación de archivo, no mutación).

    Genérico: cualquier recurso con contenido descargable la declara. Se proyecta solo
    si el actor tiene el permiso de descarga (distinto del de lectura de metadata). El
    backend revalida permiso y visibilidad y entrega el binario con cabeceras seguras."""

    method: HttpMethod
    url_template: str


class ResourceRelatedListCapability(ApiReadSchema):
    """Lista RELACIONADA navegable por item (p. ej. signos vitales de una consulta).

    Es navegación de solo lectura, no un editor: el frontend enlaza a la lista del
    recurso destino con ``parameter_name=<valor de la referencia del item>`` (el
    filtro EQ ya publicado por ``filterable_fields`` del destino). Se proyecta solo
    si el actor tiene el permiso de LECTURA del recurso destino."""

    # Nombre REGISTRADO del recurso destino (clave de /api/v1/resources).
    resource: str
    label: str
    # Query param del filtro EQ del recurso destino que recibe el id del item.
    parameter_name: str


class NavigationModule(ApiReadSchema):
    """Módulo ESPECIALIZADO navegable (pantalla propia, no tabla genérica).

    Contrato mínimo de navegación: el frontend solo enlaza (``href``) según la
    sección (``admin`` o ``panel``); no describe columnas ni formularios — esos
    viven en la pantalla especializada. ``required_permissions`` es un *anyOf*:
    el módulo se proyecta si el usuario tiene ALGUNO de esos permisos (y el
    backend de cada pantalla revalida siempre los suyos)."""

    name: str
    label: str
    href: str
    section: Literal["admin", "panel"]
    # anyOf: basta uno para que el módulo sea visible. Es la ÚNICA parte del
    # contrato que declara permisos: son requisitos de navegación, no capacidades.
    required_permissions: list[str]


class ResourceCapability(ApiReadSchema):
    name: str
    label: str
    api_path: str
    view: ResourceView
    item_reference: Optional[ItemReference] = None
    detail: Optional[ResourceDetailCapability] = None
    # Descarga de binario por item (recursos con contenido de archivo). Omitido si el
    # recurso no declara descarga o el actor no tiene el permiso.
    file_download: Optional[ResourceFileDownloadCapability] = None
    # El atributo se llama ``list_`` para no sombrear el builtin ``list`` dentro del
    # cuerpo de la clase; se serializa/valida como ``list`` vía alias.
    list_: Optional[ResourceListCapability] = Field(default=None, alias="list")
    forms: Optional[ResourceFormsCapability] = None
    actions: list[ResourceActionCapability] = []
    relations: list[ResourceRelationCapability] = []
    # Listas relacionadas navegables por item, filtradas por permiso de lectura del
    # recurso destino.
    related_lists: list[ResourceRelatedListCapability] = []


class ResourceCatalogResponse(ApiReadSchema):
    """Respuesta de ``GET /api/v1/resources``: catálogo completo de navegación.

    - ``resources``: capabilities de los recursos tabulares/catálogo visibles para
      el usuario (mismo contenido que antes del envelope).
    - ``navigation_modules``: módulos ESPECIALIZADOS (pantallas propias como el
      editor del sitio o el POS) proyectados por permisos — solo aparecen los
      módulos donde el usuario tiene ALGUNO de sus ``required_permissions``.
    """

    resources: list[ResourceCapability]
    navigation_modules: list[NavigationModule] = []
