import type { components, operations } from "@/generated/openapi";

export type SessionUser = components["schemas"]["SessionUser"];

// Capabilities de recursos (Commit 3 backend). Aliases type-only sobre los schemas
// generados; nunca interfaces escritas a mano.
export type ResourceCapability = components["schemas"]["ResourceCapability"];
export type ResourceListCapability = components["schemas"]["ResourceListCapability"];
export type ResourceFieldCapability = components["schemas"]["ResourceFieldCapability"];
export type ResourceFilterCapability = components["schemas"]["ResourceFilterCapability"];
export type ResourceFilterOption = components["schemas"]["ResourceFilterOption"];
export type ResourceFormsCapability = components["schemas"]["ResourceFormsCapability"];
export type ResourceFormCapability = components["schemas"]["ResourceFormCapability"];
export type ResourceFormFieldCapability =
  components["schemas"]["ResourceFormFieldCapability"];
export type ResourceActionCapability = components["schemas"]["ResourceActionCapability"];
export type ResourceView = components["schemas"]["ResourceView"];
export type FieldValueType = components["schemas"]["FieldValueType"];
export type WidgetType = components["schemas"]["WidgetType"];
export type FilterOperator = components["schemas"]["FilterOperator"];

// Respuesta del catálogo derivada de la operación real (no se reescribe el array a mano).
export type ResourceCatalog =
  operations["list_resources_api_v1_resources_get"]["responses"][200]["content"]["application/json"];

export type BootstrapStatusRead = components["schemas"]["BootstrapStatusRead"];
export type BootstrapCatalogRead = components["schemas"]["BootstrapCatalogRead"];
export type BootstrapInitializeRequest = components["schemas"]["BootstrapInitializeRequest"];
export type BootstrapInitializeRead = components["schemas"]["BootstrapInitializeRead"];
export type BootstrapPermissionGroupRead = components["schemas"]["BootstrapPermissionGroupRead"];
