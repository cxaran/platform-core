import type { components, operations } from "@/generated/openapi";

export type SessionUser = components["schemas"]["SessionUser"];

// Cuenta del usuario autenticado (flujo dedicado, no editor genérico de users).
export type UserProfileRead = components["schemas"]["UserProfileRead"];
export type UserProfileUpdate = components["schemas"]["UserProfileUpdate"];
export type UserPasswordChangeRequest = components["schemas"]["UserPasswordChangeRequest"];

// Capabilities de recursos (Commit 3 backend). Aliases type-only sobre los schemas
// generados; nunca interfaces escritas a mano.
export type ResourceCapability = components["schemas"]["ResourceCapability"];
export type ResourceListCapability = components["schemas"]["ResourceListCapability"];
export type ResourceFieldCapability = components["schemas"]["ResourceFieldCapability"];
export type ResourceFilterCapability = components["schemas"]["ResourceFilterCapability"];
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
export type ResourceActionCapability = components["schemas"]["ResourceActionCapability"];
export type ActionRequestSpec = components["schemas"]["ActionRequestSpec"];
export type ActionConfirmation = components["schemas"]["ActionConfirmation"];
export type ActionSuccessBehavior = components["schemas"]["ActionSuccessBehavior"];
export type ItemReference = components["schemas"]["ItemReference"];
export type ResourceDetailCapability = components["schemas"]["ResourceDetailCapability"];
export type ResourceRelationCapability = components["schemas"]["ResourceRelationCapability"];
export type RelationOptionsSource = components["schemas"]["RelationOptionsSource"];
export type RelationCardinality = components["schemas"]["RelationCardinality"];
export type OptionsSourceType = components["schemas"]["OptionsSourceType"];
export type ResourceView = components["schemas"]["ResourceView"];
export type FieldValueType = components["schemas"]["FieldValueType"];
export type WidgetType = components["schemas"]["WidgetType"];
export type FilterOperator = components["schemas"]["FilterOperator"];
export type HttpMethod = components["schemas"]["HttpMethod"];

// Respuesta del catálogo derivada de la operación real (no se reescribe el array a mano).
export type ResourceCatalog =
  operations["list_resources_api_v1_resources_get"]["responses"][200]["content"]["application/json"];

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
