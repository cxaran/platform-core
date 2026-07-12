import { describe, expect, it } from "vitest";
import { ModelDiscoveryService } from "../../src/application/capabilities/model-discovery.js";
import { createFakeModel } from "../../src/domain/model.js";
import { createOpencodeModel } from "../../src/providers/opencode/adapter.js";
import { GatewayError } from "../../src/kernel/errors.js";
import type { ModelDescriptor } from "../../src/domain/model.js";
import type { ControlPlanePort } from "../../src/ports/control-plane.port.js";
import type { ProviderAdapter, ProviderCredentialLease } from "../../src/ports/provider-adapter.port.js";
import type { ProviderRegistryPort } from "../../src/ports/provider-registry.port.js";
import type { ModelCatalogPort } from "../../src/ports/model-catalog.port.js";
import type { TelemetryPort } from "../../src/ports/telemetry.port.js";

const BASE = "https://opencode.ai/zen/v1";
const lease: ProviderCredentialLease = {
  leaseId: "lease-1",
  secret: "sk-leased",
  expiresAt: new Date(Date.now() + 60_000)
};

const curatedOpencode = createOpencodeModel({ baseUrl: BASE, modelId: "claude-haiku-4-5" });
const curated: ModelDescriptor[] = [createFakeModel(), curatedOpencode];

const telemetry: TelemetryPort = { info() {}, warn() {}, error() {} };

function catalog(): ModelCatalogPort {
  return {
    async list() {
      return curated;
    },
    async resolve({ providerId, modelId }) {
      const found = curated.find(
        (m) => m.route.providerId === providerId && m.route.providerModelId === modelId
      );
      if (!found) {
        throw new GatewayError("MODEL_NOT_FOUND", "no curado", { providerId, modelId });
      }
      return found;
    }
  };
}

function registry(adapter: Partial<ProviderAdapter>): ProviderRegistryPort {
  return {
    get: () => adapter as ProviderAdapter,
    protocols: () => ["opencode_zen"]
  };
}

function controlPlane(
  leaseFor: (providerId: string) => ProviderCredentialLease | null
): ControlPlanePort {
  return {
    authorizeTurn: async () => {
      throw new Error("no usado");
    },
    leaseCredential: async () => lease,
    leaseCredentialForProvider: async ({ providerId }) => leaseFor(providerId),
    releaseCredentialLease: async () => {},
    reportTurnUsage: async () => {}
  };
}

describe("ModelDiscoveryService", () => {
  it("listForUser sustituye el curado del proveedor por los modelos REALES descubiertos", async () => {
    const discovered = [
      createOpencodeModel({ baseUrl: BASE, modelId: "deepseek-v4-flash-free" }),
      createOpencodeModel({ baseUrl: BASE, modelId: "qwen3.6-plus" })
    ];
    const service = new ModelDiscoveryService({
      controlPlane: controlPlane(() => lease),
      providerRegistry: registry({ discoverModels: async () => discovered }),
      modelCatalog: catalog(),
      telemetry,
      discoverableProviderIds: ["opencode_zen"]
    });

    const models = await service.listForUser("user-1");
    const ids = models.map((m) => m.id);
    // El fake (curado) sigue; el curado opencode se reemplaza por los descubiertos.
    expect(ids).toContain("fake/fake-model");
    expect(ids).toContain("opencode_zen/deepseek-v4-flash-free");
    expect(ids).toContain("opencode_zen/qwen3.6-plus");
    expect(ids).not.toContain("opencode_zen/claude-haiku-4-5");
  });

  it("listForUser conserva el curado si el usuario no tiene credencial (lease null)", async () => {
    const service = new ModelDiscoveryService({
      controlPlane: controlPlane(() => null),
      providerRegistry: registry({
        discoverModels: async () => {
          throw new Error("no debería llamarse sin lease");
        }
      }),
      modelCatalog: catalog(),
      telemetry,
      discoverableProviderIds: ["opencode_zen"]
    });

    const models = await service.listForUser("user-1");
    expect(models.map((m) => m.id)).toContain("opencode_zen/claude-haiku-4-5");
  });

  it("listForUser conserva el curado si /models falla (best-effort)", async () => {
    const service = new ModelDiscoveryService({
      controlPlane: controlPlane(() => lease),
      providerRegistry: registry({
        discoverModels: async () => {
          throw new GatewayError("PROVIDER_DISCOVERY_FAILED", "boom");
        }
      }),
      modelCatalog: catalog(),
      telemetry,
      discoverableProviderIds: ["opencode_zen"]
    });

    const models = await service.listForUser("user-1");
    expect(models.map((m) => m.id)).toContain("opencode_zen/claude-haiku-4-5");
  });

  it("resolveForUser devuelve el modelo descubierto (capacidades del proveedor)", async () => {
    const discovered = [
      createOpencodeModel({
        baseUrl: BASE,
        modelId: "deepseek-v4-flash-free",
        row: { id: "deepseek-v4-flash-free", context_length: 65_536, supports_tools: true }
      })
    ];
    const service = new ModelDiscoveryService({
      controlPlane: controlPlane(() => lease),
      providerRegistry: registry({ discoverModels: async () => discovered }),
      modelCatalog: catalog(),
      telemetry,
      discoverableProviderIds: ["opencode_zen"]
    });

    const model = await service.resolveForUser("user-1", "opencode_zen", "deepseek-v4-flash-free");
    expect(model.id).toBe("opencode_zen/deepseek-v4-flash-free");
    expect(model.source).toBe("discovered");
    expect(model.capabilities.contextWindowTokens).toBe(65_536);
  });

  it("resolveForUser cae al catálogo curado cuando no hay credencial del proveedor", async () => {
    const service = new ModelDiscoveryService({
      controlPlane: controlPlane(() => null),
      providerRegistry: registry({
        discoverModels: async () => {
          throw new Error("no debería llamarse");
        }
      }),
      modelCatalog: catalog(),
      telemetry,
      discoverableProviderIds: ["opencode_zen"]
    });

    const model = await service.resolveForUser("user-1", "opencode_zen", "claude-haiku-4-5");
    expect(model.id).toBe("opencode_zen/claude-haiku-4-5");
    expect(model.source).toBe("curated");
  });

  it("resolveForUser usa el ÚLTIMO catálogo bueno si un discovery posterior falla (blip de red)", async () => {
    // 1er discovery OK: puebla el cache "último bueno" con un modelo NO curado.
    const discovered = [
      createOpencodeModel({
        baseUrl: BASE,
        modelId: "deepseek-v4-flash-free",
        row: { id: "deepseek-v4-flash-free", context_length: 65_536, supports_tools: true }
      })
    ];
    let shouldFail = false;
    const service = new ModelDiscoveryService({
      controlPlane: controlPlane(() => lease),
      providerRegistry: registry({
        discoverModels: async () => {
          if (shouldFail) {
            throw new GatewayError("PROVIDER_DISCOVERY_FAILED", "fetch failed");
          }
          return discovered;
        }
      }),
      modelCatalog: catalog(),
      telemetry,
      discoverableProviderIds: ["opencode_zen"],
      // TTL 0: fuerza a re-descubrir en cada resolve (sin usar el cache rápido).
      cacheTtlMs: 0
    });

    const first = await service.resolveForUser("user-1", "opencode_zen", "deepseek-v4-flash-free");
    expect(first.id).toBe("opencode_zen/deepseek-v4-flash-free");

    // 2do discovery FALLA: el modelo no está en el curado, pero el "último bueno" lo rescata en
    // vez de matar el turno con MODEL_NOT_FOUND.
    shouldFail = true;
    const salvaged = await service.resolveForUser("user-1", "opencode_zen", "deepseek-v4-flash-free");
    expect(salvaged.id).toBe("opencode_zen/deepseek-v4-flash-free");
    expect(salvaged.capabilities.contextWindowTokens).toBe(65_536);
  });
});
