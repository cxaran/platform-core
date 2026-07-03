import { ResourceCatalog } from "@/components/dashboard/ResourceCatalog";
import {
  EnvironmentBadge,
  SetupChecklistBanner,
} from "@/components/system/SetupChecklistBanner";
import { getResourceCatalog } from "@/core/resources/capabilities-client";
import { getSetupChecklist } from "@/core/system-settings/checklist-data";
import { shouldShowBanner } from "@/core/system-settings/setup-checklist";

export default async function DashboardPage() {
  const resources = await getResourceCatalog();
  // Checklist de puesta en marcha DERIVADO del backend (degrada a null sin permiso).
  const checklist = await getSetupChecklist();

  return (
    <>
      <ResourceCatalog resources={resources} />
      {checklist ? <EnvironmentBadge environment={checklist.environment} /> : null}
      {shouldShowBanner(checklist) && checklist ? (
        <SetupChecklistBanner checklist={checklist} />
      ) : null}
    </>
  );
}
