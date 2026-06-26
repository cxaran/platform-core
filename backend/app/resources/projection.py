"""Proyección de ``ResourceDefinition`` → ``ResourceCapability`` filtrada por usuario.

Metadata UI (label/widget/visibilidad/tipo) viene de los schemas Pydantic; las
capacidades técnicas (sortable/searchable/operadores/orden/límites) vienen del
``CompiledQueryPlan`` expuesto por ``ResourceQuery.plan``. La autorización usa
``SecurityControl.check(current_user)``; nunca se serializan permisos ni internals.
"""

from datetime import date, datetime
from decimal import Decimal
from enum import Enum
from types import UnionType
from typing import Annotated, Any, Optional, Union, get_args, get_origin
from uuid import UUID

import annotated_types as at
from pydantic import BaseModel, EmailStr, SecretStr
from pydantic.fields import FieldInfo

from backend.app.query.operators import Operator
from backend.app.query.plans import CompiledQueryPlan
from backend.app.resources.registry import (
    ActionDef,
    RelationDef,
    ResourceDefinition,
    get_resource,
    RESOURCE_REGISTRY,
)
from backend.app.schemas.capabilities import (
    ActionConfirmation,
    ActionRequestSpec,
    ActionSuccessBehavior,
    FieldValueType,
    FilterableFieldCapability,
    FilterableOperatorCapability,
    FilterableRangeParameters,
    FilterOperator,
    FilterValueShape,
    HttpMethod,
    ItemReference,
    PaginationCapability,
    RelationOptionsSource,
    ResourceDetailCapability,
    ResourceActionCapability,
    ResourceCapability,
    ResourceFieldCapability,
    ResourceFilterCapability,
    ResourceFilterOption,
    ResourceFormCapability,
    ResourceFormFieldCapability,
    ResourceFormsCapability,
    ResourceListCapability,
    ResourceRelationCapability,
    ResourceView,
    SearchCapability,
    SortCapability,
    WidgetType,
)
from backend.app.schemas.user import SessionUser

_FILTER_OPERATOR_ORDER = (
    FilterOperator.EQ,
    FilterOperator.GTE,
    FilterOperator.LTE,
    FilterOperator.IN,
    FilterOperator.ISNULL,
)


class CapabilityConfigError(ValueError):
    """Un campo declarado para lista/formulario carece de metadata obligatoria."""


# --- Resolución de metadata UI desde el schema ---


def _ui(field_info: FieldInfo) -> dict[str, Any]:
    extra = field_info.json_schema_extra
    if isinstance(extra, dict):
        ui = extra.get("ui")
        if isinstance(ui, dict):
            return ui
    return {}


def _require_label(field_info: FieldInfo, field_name: str) -> str:
    ui = _ui(field_info)
    label = ui.get("label") or field_info.title
    if not label:
        raise CapabilityConfigError(
            f"El campo '{field_name}' debe declarar un label explícito (title o ui.label)."
        )
    return label


def _unwrap_annotated(annotation: Any) -> Any:
    value = annotation
    while get_origin(value) is Annotated:
        value = get_args(value)[0]
    return value


def _unwrap(annotation: Any) -> Any:
    value = _unwrap_annotated(annotation)
    if get_origin(value) in (Union, UnionType):
        args = [_unwrap_annotated(arg) for arg in get_args(value) if arg is not type(None)]
        if len(args) == 1:
            return args[0]
    return value


def _value_type(annotation: Any) -> FieldValueType:
    inner = _unwrap(annotation)
    if get_origin(inner) in (list, tuple, set, frozenset):
        return FieldValueType.ARRAY
    if inner is EmailStr:
        return FieldValueType.EMAIL
    if inner is SecretStr or inner is str:
        return FieldValueType.STRING
    if inner is UUID:
        return FieldValueType.UUID
    if inner is bool:
        return FieldValueType.BOOLEAN
    if inner is int:
        return FieldValueType.INTEGER
    if inner is Decimal:
        return FieldValueType.DECIMAL
    if inner is datetime:
        return FieldValueType.DATETIME
    if inner is date:
        return FieldValueType.DATE
    if isinstance(inner, type) and issubclass(inner, Enum):
        return FieldValueType.ENUM
    raise CapabilityConfigError(f"Tipo no mapeable a capability: {inner!r}")


def _constraint(field_info: FieldInfo, kind: str) -> Optional[int]:
    for meta in field_info.metadata:
        if kind == "le" and isinstance(meta, at.Le):
            return int(meta.le)  # type: ignore[arg-type]
        if kind == "min_length" and isinstance(meta, at.MinLen):
            return meta.min_length
        if kind == "max_length" and isinstance(meta, at.MaxLen):
            return meta.max_length
    return None


# --- Capacidades técnicas desde el plan ---


def _searchable_field_names(plan: CompiledQueryPlan) -> set[str]:
    search_ids = {id(column) for column in plan.search_columns}
    return {name for name, column in plan.all_columns.items() if id(column) in search_ids}


def _filter_operators(plan: CompiledQueryPlan, name: str) -> list[FilterOperator]:
    present: set[FilterOperator] = set()
    if name in plan.filter_columns:
        present.add(FilterOperator.EQ)
    if name in plan.range_fields:
        present.add(FilterOperator.GTE)
        present.add(FilterOperator.LTE)
    if name in plan.in_fields:
        present.add(FilterOperator.IN)
    if name in plan.null_filter_fields:
        present.add(FilterOperator.ISNULL)
    return [operator for operator in _FILTER_OPERATOR_ORDER if operator in present]


def _sort_capability(plan: CompiledQueryPlan, sort_max_length: Optional[int]) -> SortCapability:
    public = set(plan.public_sort_columns.keys())
    terms = [
        term[1:] if term.startswith("-") else term
        for term in (raw.strip() for raw in plan.default_order.split(","))
        if term
    ]
    all_public = bool(terms) and all(term in public for term in terms)
    max_length = plan.max_sort_length if plan.max_sort_length is not None else sort_max_length
    return SortCapability(
        default_sort=plan.default_order if all_public else None,
        fixed_server_order=not all_public,
        max_terms=plan.max_sort_terms,
        max_length=int(max_length) if max_length is not None else plan.max_sort_terms,
    )


# --- Construcción de capabilities ---


def _filter_options(
    field_name: str, widget: WidgetType, raw: Any
) -> Optional[list[ResourceFilterOption]]:
    if widget != WidgetType.SELECT:
        # Los widgets sin opciones (futuros) no las llevan en este alcance.
        return None
    if not isinstance(raw, list) or len(raw) == 0:
        raise CapabilityConfigError(
            f"El filtro '{field_name}' (select) requiere al menos una opción."
        )
    options: list[ResourceFilterOption] = []
    seen: set[str] = set()
    for entry in raw:
        if not isinstance(entry, dict):
            raise CapabilityConfigError(f"El filtro '{field_name}' tiene una opción inválida.")
        value = entry.get("value")
        label = entry.get("label")
        if not isinstance(value, str) or value == "":
            raise CapabilityConfigError(
                f"El filtro '{field_name}' tiene una opción con value vacío o no string."
            )
        if not isinstance(label, str) or label.strip() == "":
            raise CapabilityConfigError(
                f"El filtro '{field_name}' tiene una opción sin label explícito."
            )
        if value in seen:
            raise CapabilityConfigError(
                f"El filtro '{field_name}' tiene el value de opción duplicado: {value}."
            )
        seen.add(value)
        options.append(ResourceFilterOption(value=value, label=label))
    return options


def _filter_capabilities(
    plan: CompiledQueryPlan,
    query_schema: type[Any],
    list_schema: type[BaseModel],
    field_caps: dict[str, ResourceFieldCapability],
) -> list[ResourceFilterCapability]:
    param_index = {
        (parameter.field_name, parameter.operator): parameter.parameter_name
        for parameter in plan.filter_parameters
    }
    filters: list[ResourceFilterCapability] = []
    seen_parameters: set[str] = set()

    for name, field_info in list_schema.model_fields.items():
        declaration = _ui(field_info).get("filter")
        if not isinstance(declaration, dict):
            continue

        field_cap = field_caps.get(name)
        if field_cap is None:
            raise CapabilityConfigError(
                f"El filtro '{name}' no referencia un campo emitido en list.fields."
            )

        try:
            operator = Operator(declaration.get("operator"))
        except ValueError as error:
            raise CapabilityConfigError(
                f"El filtro '{name}' declara un operador inválido: {declaration.get('operator')!r}."
            ) from error

        parameter = param_index.get((name, operator))
        if parameter is None:
            raise CapabilityConfigError(
                f"El filtro '{name}' usa el operador '{operator.value}' ausente en el plan del campo."
            )
        if parameter not in query_schema.model_fields:
            raise CapabilityConfigError(
                f"El parámetro '{parameter}' del filtro '{name}' no existe en el query schema."
            )
        if parameter in seen_parameters:
            raise CapabilityConfigError(
                f"El parámetro de filtro '{parameter}' está duplicado entre filtros visibles."
            )
        seen_parameters.add(parameter)

        public_operator = FilterOperator(operator.value)
        if public_operator not in field_cap.filter_operators:
            raise CapabilityConfigError(
                f"El operador '{operator.value}' no está en filter_operators de '{name}'."
            )

        label = declaration.get("label")
        if not isinstance(label, str) or label.strip() == "":
            raise CapabilityConfigError(f"El filtro '{name}' requiere un label explícito.")

        try:
            widget = WidgetType(declaration.get("widget"))
        except ValueError as error:
            raise CapabilityConfigError(
                f"El filtro '{name}' declara un widget inválido: {declaration.get('widget')!r}."
            ) from error

        filters.append(
            ResourceFilterCapability(
                field=name,
                parameter=parameter,
                operator=public_operator,
                label=label,
                description=field_info.description,
                type=field_cap.type,
                widget=widget,
                options=_filter_options(name, widget, declaration.get("options")),
            )
        )

    return filters


# --- Filtros declarativos visibles (filterable_fields, C1) ---

# Orden de presentación de los operadores filtrables visibles de un campo. ``in``,
# ``isnull``, ``gte`` y ``lte`` no se publican como filtros visibles en este alcance.
_FILTERABLE_OPERATOR_ORDER = (
    Operator.CONTAINS,
    Operator.STARTS_WITH,
    Operator.ENDS_WITH,
    Operator.EQ,
    Operator.NE,
    Operator.ON,
    Operator.BEFORE,
    Operator.AFTER,
    Operator.BETWEEN,
)

_TEXT_MATCH_LABELS = {
    Operator.CONTAINS: "Contiene",
    Operator.STARTS_WITH: "Empieza por",
    Operator.ENDS_WITH: "Termina en",
}
_CALENDAR_LABELS = {
    Operator.ON: "En la fecha",
    Operator.BEFORE: "Antes de",
    Operator.AFTER: "Después de",
}


def _default_eq_widget(value_type: FieldValueType) -> WidgetType:
    if value_type is FieldValueType.BOOLEAN:
        return WidgetType.SWITCH
    return WidgetType.TEXT


def _eq_filter_declaration(
    field_name: str, field_info: FieldInfo
) -> tuple[Optional[list[ResourceFilterOption]], Optional[WidgetType]]:
    """Opciones/widget declarados para el ``eq`` de un campo vía ``ui.filter`` (select).

    Reusa la única declaración existente (p. ej. ``is_active`` con Activos/Inactivos);
    si no hay declaración select, ``eq`` toma el widget por defecto del tipo."""
    declaration = _ui(field_info).get("filter")
    if not isinstance(declaration, dict) or declaration.get("operator") != "eq":
        return None, None
    try:
        widget = WidgetType(declaration.get("widget"))
    except ValueError:
        return None, None
    if widget is not WidgetType.SELECT:
        return None, None
    return _filter_options(field_name, widget, declaration.get("options")), widget


def _filterable_operator(
    operator: Operator,
    *,
    value_type: FieldValueType,
    parameter: Optional[str],
    range_params: Optional[tuple[str, str]],
    eq_options: Optional[list[ResourceFilterOption]],
    eq_widget: Optional[WidgetType],
    calendar_tz: str,
) -> FilterableOperatorCapability:
    key = FilterOperator(operator.value)
    if operator in _TEXT_MATCH_LABELS:
        return FilterableOperatorCapability(
            key=key,
            label=_TEXT_MATCH_LABELS[operator],
            value_shape=FilterValueShape.SINGLE,
            widget=WidgetType.TEXT,
            parameter_name=parameter,
            case_sensitive=False,
        )
    if operator is Operator.EQ:
        return FilterableOperatorCapability(
            key=key,
            label="Es igual a",
            value_shape=FilterValueShape.SINGLE,
            widget=eq_widget or _default_eq_widget(value_type),
            parameter_name=parameter,
            options=eq_options,
            case_sensitive=True if value_type in (FieldValueType.STRING, FieldValueType.EMAIL) else None,
        )
    if operator is Operator.NE:
        return FilterableOperatorCapability(
            key=key,
            label="No es igual a",
            value_shape=FilterValueShape.SINGLE,
            widget=WidgetType.TEXT,
            parameter_name=parameter,
            case_sensitive=True,
        )
    if operator in _CALENDAR_LABELS:
        return FilterableOperatorCapability(
            key=key,
            label=_CALENDAR_LABELS[operator],
            value_shape=FilterValueShape.SINGLE,
            widget=WidgetType.DATE,
            parameter_name=parameter,
            calendar_timezone=calendar_tz,
        )
    # between: dos parámetros, extremo superior inclusivo para el usuario.
    assert range_params is not None
    return FilterableOperatorCapability(
        key=key,
        label="Entre",
        value_shape=FilterValueShape.RANGE,
        widget=WidgetType.DATERANGE,
        parameters=FilterableRangeParameters.model_validate(
            {"from": range_params[0], "to": range_params[1]}
        ),
        calendar_timezone=calendar_tz,
        range_end_inclusive=True,
    )


def _filterable_fields(
    plan: CompiledQueryPlan,
    list_schema: type[BaseModel],
    field_caps: dict[str, ResourceFieldCapability],
) -> list[FilterableFieldCapability]:
    """Proyecta el contrato de filtros declarativos desde el plan compilado.

    Fuente única: ``eq`` viene de ``filter_parameters``; los operadores extendidos de
    C1 vienen de ``extended_filters``. Solo se publican campos emitidos en
    ``list.fields`` (con label/tipo); ``id`` y demás internos quedan fuera."""
    eq_params = {
        parameter.field_name: parameter.parameter_name
        for parameter in plan.filter_parameters
        if parameter.operator is Operator.EQ
    }
    ext_single = {
        (descriptor.field_name, descriptor.operator): descriptor.parameter_name
        for descriptor in plan.extended_filters
        if descriptor.parameter_name is not None
    }
    ext_range = {
        descriptor.field_name: (descriptor.from_parameter, descriptor.to_parameter)
        for descriptor in plan.extended_filters
        if descriptor.operator is Operator.BETWEEN
    }
    calendar_tz = plan.calendar_timezone

    result: list[FilterableFieldCapability] = []
    for name, field_cap in field_caps.items():
        field_info = list_schema.model_fields[name]
        eq_options, eq_widget = _eq_filter_declaration(name, field_info)
        operators: list[FilterableOperatorCapability] = []

        for operator in _FILTERABLE_OPERATOR_ORDER:
            if operator is Operator.BETWEEN:
                range_params = ext_range.get(name)
                if range_params is None or range_params[0] is None or range_params[1] is None:
                    continue
                operators.append(
                    _filterable_operator(
                        operator,
                        value_type=field_cap.type,
                        parameter=None,
                        range_params=(range_params[0], range_params[1]),
                        eq_options=None,
                        eq_widget=None,
                        calendar_tz=calendar_tz,
                    )
                )
                continue

            if operator is Operator.EQ:
                parameter = eq_params.get(name)
            else:
                parameter = ext_single.get((name, operator))
            if parameter is None:
                continue

            operators.append(
                _filterable_operator(
                    operator,
                    value_type=field_cap.type,
                    parameter=parameter,
                    range_params=None,
                    eq_options=eq_options,
                    eq_widget=eq_widget,
                    calendar_tz=calendar_tz,
                )
            )

        if not operators:
            continue
        result.append(
            FilterableFieldCapability(
                key=name,
                label=field_cap.label,
                description=field_cap.description,
                value_type=field_cap.type,
                operators=operators,
            )
        )
    return result


def _list_capability(definition: ResourceDefinition) -> ResourceListCapability:
    assert definition.list_query is not None and definition.list_schema is not None
    plan = definition.list_query.plan
    query_schema = definition.list_query.Query
    list_schema = definition.list_schema
    searchable = _searchable_field_names(plan)

    fields: list[ResourceFieldCapability] = []
    field_caps: dict[str, ResourceFieldCapability] = {}
    for name, field_info in list_schema.model_fields.items():
        ui = _ui(field_info)
        visible_in_list = bool(ui.get("list", False))
        has_filter = isinstance(ui.get("filter"), dict)
        # Se emite metadata pública del campo si está declarado para lista o para filtro,
        # aunque no sea columna visible (visible_in_list=False).
        if not (visible_in_list or has_filter):
            continue
        cap = ResourceFieldCapability(
            name=name,
            label=_require_label(field_info, name),
            description=field_info.description,
            type=_value_type(field_info.annotation),
            visible_in_list=visible_in_list,
            sortable=name in plan.public_sort_columns,
            searchable=name in searchable,
            filter_operators=_filter_operators(plan, name),
        )
        fields.append(cap)
        field_caps[name] = cap

    filters = _filter_capabilities(plan, query_schema, list_schema, field_caps)
    filterable_fields = _filterable_fields(plan, list_schema, field_caps)

    limit_field = query_schema.model_fields["limit"]
    pagination = PaginationCapability(
        default_limit=int(limit_field.default),
        max_limit=int(_constraint(limit_field, "le") or limit_field.default),
    )

    if "q" in query_schema.model_fields:
        q_field = query_schema.model_fields["q"]
        search = SearchCapability(
            enabled=True,
            min_length=_constraint(q_field, "min_length"),
            max_length=_constraint(q_field, "max_length"),
        )
    else:
        search = SearchCapability(enabled=False)

    sort = _sort_capability(plan, _constraint(query_schema.model_fields["sort"], "max_length"))
    return ResourceListCapability(
        fields=fields,
        filters=filters,
        filterable_fields=filterable_fields,
        pagination=pagination,
        search=search,
        sort=sort,
    )


def _form_fields(write_schema: type[BaseModel]) -> list[ResourceFormFieldCapability]:
    fields: list[ResourceFormFieldCapability] = []
    for name, field_info in write_schema.model_fields.items():
        ui = _ui(field_info)
        if not ui.get("form", False):
            continue
        widget_raw = ui.get("widget")
        fields.append(
            ResourceFormFieldCapability(
                name=name,
                label=_require_label(field_info, name),
                description=field_info.description,
                type=_value_type(field_info.annotation),
                required=field_info.is_required(),
                editable=True,
                widget=WidgetType(widget_raw) if widget_raw is not None else None,
            )
        )
    return fields


def _forms_capability(
    definition: ResourceDefinition, user: SessionUser
) -> Optional[ResourceFormsCapability]:
    create: Optional[ResourceFormCapability] = None
    update: Optional[ResourceFormCapability] = None

    if (
        definition.create_schema is not None
        and definition.create_permission is not None
        and definition.create_permission.check(user)
    ):
        create = ResourceFormCapability(
            method=HttpMethod.POST,
            url_template=definition.api_path,
            fields=_form_fields(definition.create_schema),
        )

    if (
        definition.update_schema is not None
        and definition.update_permission is not None
        and definition.update_permission.check(user)
    ):
        update = ResourceFormCapability(
            method=HttpMethod.PATCH,
            url_template=f"{definition.api_path}/{{id}}",
            fields=_form_fields(definition.update_schema),
        )

    if create is None and update is None:
        return None
    return ResourceFormsCapability(create=create, update=update)


def _action_capability(action: ActionDef) -> ResourceActionCapability:
    request = (
        ActionRequestSpec(content_type="application/json", fixed_body=action.fixed_body)
        if action.fixed_body is not None
        else None
    )
    confirmation = (
        ActionConfirmation(
            required=action.confirmation.required,
            title=action.confirmation.title,
            message=action.confirmation.message,
            confirm_label=action.confirmation.confirm_label,
            destructive=action.confirmation.destructive,
        )
        if action.confirmation is not None
        else None
    )
    return ResourceActionCapability(
        name=action.name,
        label=action.label,
        method=action.method,
        url_template=action.url_template,
        scope=action.scope,
        danger=action.danger,
        request=request,
        confirmation=confirmation,
        success_behavior=ActionSuccessBehavior.REFRESH,
    )


def _relation_capability(relation: RelationDef) -> ResourceRelationCapability:
    return ResourceRelationCapability(
        name=relation.name,
        label=relation.label,
        description=relation.description,
        cardinality=relation.cardinality,
        required=relation.required,
        editable=True,
        selection_url=relation.selection_url_template,
        selection_field=relation.selection_field,
        mutation_method=relation.mutation_method,
        mutation_url=relation.mutation_url_template,
        request_field=relation.request_field,
        options=RelationOptionsSource(
            type=relation.options_type,
            url=relation.options_url,
            value_field=relation.options_value_field,
            label_field=relation.options_label_field,
        ),
    )


def _build_capability(definition: ResourceDefinition, user: SessionUser) -> ResourceCapability:
    list_cap: Optional[ResourceListCapability] = None
    forms_cap: Optional[ResourceFormsCapability] = None

    if definition.view == ResourceView.TABLE and definition.list_query is not None:
        list_cap = _list_capability(definition)
        forms_cap = _forms_capability(definition, user)

    actions = [
        _action_capability(action)
        for action in definition.actions
        if action.permission.check(user)
    ]

    # Una relación se proyecta solo si el actor puede editarla (además del permiso
    # de lectura del recurso, ya filtrado al elegir el recurso visible).
    relations = [
        _relation_capability(relation)
        for relation in definition.relations
        if relation.permission.check(user)
    ]

    # ``item_reference`` y ``detail`` se publican juntos cuando el recurso declara
    # lectura individual. El permiso de detalle es el de lectura del recurso, ya
    # garantizado al construir un recurso visible.
    item_reference: Optional[ItemReference] = None
    detail: Optional[ResourceDetailCapability] = None
    if definition.detail_url_template is not None:
        item_reference = ItemReference(
            field=definition.item_id_field,
            placeholder="id",
            type=FieldValueType.UUID,
        )
        detail = ResourceDetailCapability(
            method=HttpMethod.GET,
            url_template=definition.detail_url_template,
        )

    return ResourceCapability(
        name=definition.name,
        label=definition.label,
        api_path=definition.api_path,
        view=definition.view,
        item_reference=item_reference,
        detail=detail,
        list=list_cap,
        forms=forms_cap,
        actions=actions,
        relations=relations,
    )


def build_visible_capabilities(user: SessionUser) -> list[ResourceCapability]:
    """Capabilities de todos los recursos cuyo permiso de lectura pasa para el usuario."""
    return [
        _build_capability(definition, user)
        for definition in RESOURCE_REGISTRY
        if definition.read_permission.check(user)
    ]


def build_capability_if_visible(
    name: str, user: SessionUser
) -> Optional[ResourceCapability]:
    """Capability de un recurso, o ``None`` si no existe o no es visible (mismo 404)."""
    definition = get_resource(name)
    if definition is None or not definition.read_permission.check(user):
        return None
    return _build_capability(definition, user)
