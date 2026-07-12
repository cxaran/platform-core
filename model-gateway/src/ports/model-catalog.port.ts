import type { ModelDescriptor, ModelId, ProviderId } from "../domain/model.js";

// Vistas de catálogo (patrón OpenClaw models.list view=default|configured|all). B6 solo
// expone "default"; el resto se añade en rebanadas posteriores.
export type CatalogView = "default";

export interface ModelCatalogPort {
  resolve(input: { providerId: ProviderId; modelId: ModelId }): Promise<ModelDescriptor>;
  list(input?: { view?: CatalogView }): Promise<ModelDescriptor[]>;
}
