import { requireSession } from "@/core/auth/session";
import { ResourceCatalog } from "@/components/dashboard/ResourceCatalog";
import { getResourceCatalog } from "@/core/resources/capabilities-client";

// Índice del CATÁLOGO COMPLETO de recursos, reincorporado a la navegación principal. Server
// component: lee el catálogo permission-projected (GET /api/v1/resources) y delega el render de
// las tarjetas a ResourceCatalog, que enlaza cada recurso de tipo "table" a /resources/{name}.
// A diferencia de la barra lateral (lista curada), aquí aparecen TODOS los recursos visibles
// para el rol del usuario.
export default async function ResourcesIndexPage() {
  await requireSession();
  const resources = await getResourceCatalog();
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold text-slate-900">Recursos</h1>
      <ResourceCatalog resources={resources} />
    </div>
  );
}
