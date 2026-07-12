import { GatewayError } from "../kernel/errors.js";
import type { ProviderProtocol } from "../domain/model.js";
import type { ProviderAdapter } from "../ports/provider-adapter.port.js";
import type { ProviderRegistryPort } from "../ports/provider-registry.port.js";

export class ProviderRegistry implements ProviderRegistryPort {
  private readonly adapters = new Map<ProviderProtocol, ProviderAdapter>();

  constructor(adapters: ProviderAdapter[]) {
    for (const adapter of adapters) {
      this.adapters.set(adapter.protocol, adapter);
    }
  }

  get(protocol: ProviderProtocol): ProviderAdapter {
    const adapter = this.adapters.get(protocol);
    if (!adapter) {
      throw new GatewayError("PROVIDER_PROTOCOL_NOT_REGISTERED", "Provider protocol is not registered", { protocol });
    }

    return adapter;
  }

  protocols(): ProviderProtocol[] {
    return [...this.adapters.keys()];
  }
}
