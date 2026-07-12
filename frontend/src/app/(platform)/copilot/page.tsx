import { requireSession } from "@/core/auth/session";
import { CopilotPanel } from "@/components/copilot/CopilotPanel";

// Página del COPILOTO: chat agéntico cuyo catálogo de herramientas se deriva
// automáticamente del contrato de recursos (/api/v1/resources) proyectado por RBAC.
// Toda escritura pasa por la aprobación explícita del usuario (plan canónico P1).

export const dynamic = "force-dynamic";

export default async function CopilotPage() {
  await requireSession();
  return (
    <div className="mx-auto flex h-full max-w-3xl flex-col">
      <CopilotPanel />
    </div>
  );
}
