import type { components, operations } from "@/generated/openapi";

export type SessionUser = components["schemas"]["SessionUser"];

// Cuenta del usuario autenticado (flujo dedicado, no editor genérico de users).
export type UserProfileRead = components["schemas"]["UserProfileRead"];
export type UserProfileUpdate = components["schemas"]["UserProfileUpdate"];
export type UserPasswordChangeRequest = components["schemas"]["UserPasswordChangeRequest"];

export type MessageResponse = components["schemas"]["MessageResponse"];

// Capabilities de recursos (Commit 3 backend). Aliases type-only sobre los schemas
// generados; nunca interfaces escritas a mano.
export type ResourceCapability = components["schemas"]["ResourceCapability"];
export type ResourceListCapability = components["schemas"]["ResourceListCapability"];
export type ResourceFieldCapability = components["schemas"]["ResourceFieldCapability"];
export type ResourceFilterOption = components["schemas"]["ResourceFilterOption"];
export type FilterableFieldCapability = components["schemas"]["FilterableFieldCapability"];
export type FilterableOperatorCapability =
  components["schemas"]["FilterableOperatorCapability"];
export type FilterableRangeParameters = components["schemas"]["FilterableRangeParameters"];
export type FilterValueShape = components["schemas"]["FilterValueShape"];
export type ResourceFormsCapability = components["schemas"]["ResourceFormsCapability"];
export type ResourceFormCapability = components["schemas"]["ResourceFormCapability"];
export type ResourceFormFieldCapability =
  components["schemas"]["ResourceFormFieldCapability"];
// Formularios con carga de archivo (multipart) y descarga de binario por item.
export type FormTransport = components["schemas"]["FormTransport"];
export type ResourceFileFieldCapability =
  components["schemas"]["ResourceFileFieldCapability"];
export type ResourceFileDownloadCapability =
  components["schemas"]["ResourceFileDownloadCapability"];
export type ResourceActionCapability = components["schemas"]["ResourceActionCapability"];
export type ActionRequestSpec = components["schemas"]["ActionRequestSpec"];
export type ActionConfirmation = components["schemas"]["ActionConfirmation"];
export type ActionSuccessBehavior = components["schemas"]["ActionSuccessBehavior"];
// Formulario de entrada declarado de una acción (B2) y DSL serializable de condiciones
// de estado (B3). Sólo guía de UI: el backend revalida la transición en cada ejecución.
export type ActionInputSchema = components["schemas"]["ActionInputSchema"];
export type ActionCondition = components["schemas"]["ActionCondition"];
export type ActionConditionPredicate = components["schemas"]["ActionConditionPredicate"];
export type ActionConditionOperator = components["schemas"]["ActionConditionOperator"];
export type ItemReference = components["schemas"]["ItemReference"];
export type ResourceDetailCapability = components["schemas"]["ResourceDetailCapability"];
export type ResourceRelationCapability = components["schemas"]["ResourceRelationCapability"];
// Lista relacionada navegable por item (p. ej. signos vitales de una consulta): enlace a la
// lista del recurso destino filtrada con parameter_name=<id del item>. Solo lectura.
export type ResourceRelatedListCapability =
  components["schemas"]["ResourceRelatedListCapability"];
export type RelationOptionsSource = components["schemas"]["RelationOptionsSource"];
export type OptionsSourceType = components["schemas"]["OptionsSourceType"];
export type ResourceView = components["schemas"]["ResourceView"];
export type FieldValueType = components["schemas"]["FieldValueType"];
export type WidgetType = components["schemas"]["WidgetType"];
export type FilterOperator = components["schemas"]["FilterOperator"];
export type HttpMethod = components["schemas"]["HttpMethod"];
// Autofiltro por valores (facetas) y agregados del pie de tabla.
export type ResourceFacetsResponse = components["schemas"]["ResourceFacetsResponse"];
export type FacetValueRead = components["schemas"]["FacetValueRead"];
export type ResourceStatsResponse = components["schemas"]["ResourceStatsResponse"];
export type FieldAggregatesRead = components["schemas"]["FieldAggregatesRead"];

// Respuesta del catálogo derivada de la operación real (no se reescribe a mano).
// El endpoint devuelve un envelope {resources, navigation_modules}; ``ResourceCatalog``
// sigue siendo la LISTA de recursos tabulares (los consumidores la iteran tal cual).
export type ResourceCatalogResponse =
  operations["list_resources_api_v1_resources_get"]["responses"][200]["content"]["application/json"];
export type ResourceCatalog = ResourceCatalogResponse["resources"];
// Módulo ESPECIALIZADO navegable (pantalla propia): el frontend solo enlaza su
// href según section ("admin" | "panel"); la proyección por permisos ya la hizo
// el backend al construir el catálogo. En la base el registro viene vacío.
export type NavigationModule = components["schemas"]["NavigationModule"];

// Catálogo agrupado de permisos: fuente de la vista grouped_catalog y de las
// opciones del editor de permisos de roles.
export type PermissionRead = components["schemas"]["PermissionRead"];
export type PermissionGroupRead = components["schemas"]["PermissionGroupRead"];
export type PermissionsCatalog =
  operations["list_permissions_api_v1_permissions_get"]["responses"][200]["content"]["application/json"];
export type RolePermissionsRead = components["schemas"]["RolePermissionsRead"];


export type BootstrapStatusRead = components["schemas"]["BootstrapStatusRead"];
export type BootstrapCatalogRead = components["schemas"]["BootstrapCatalogRead"];
export type BootstrapInitializeRequest = components["schemas"]["BootstrapInitializeRequest"];
export type BootstrapInitializeRead = components["schemas"]["BootstrapInitializeRead"];
export type BootstrapPermissionGroupRead = components["schemas"]["BootstrapPermissionGroupRead"];
