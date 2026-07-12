import { GatewayError } from "../../kernel/errors.js";
import { createFakeModel } from "../../domain/model.js";
import type { CatalogView, ModelCatalogPort } from "../../ports/model-catalog.port.js";
import type { ModelDescriptor, ModelId, ProviderId } from "../../domain/model.js";

export class InMemoryModelCatalog implements ModelCatalogPort {
  private readonly models = new Map<string, ModelDescriptor>();

  constructor(models: ModelDescriptor[] = [createFakeModel()]) {
    for (const model of models) {
      this.models.set(`${model.route.providerId}/${model.route.providerModelId}`, model);
    }
  }

  async resolve(input: { providerId: ProviderId; modelId: ModelId }): Promise<ModelDescriptor> {
    const model = this.models.get(`${input.providerId}/${input.modelId}`);
    if (!model) {
      throw new GatewayError("MODEL_NOT_FOUND", "Requested model route was not found", input);
    }

    return model;
  }

  async list(_input?: { view?: CatalogView }): Promise<ModelDescriptor[]> {
    // MG-001/B6: una sola vista ("default"); devuelve todo el catálogo en memoria.
    return [...this.models.values()];
  }
}
