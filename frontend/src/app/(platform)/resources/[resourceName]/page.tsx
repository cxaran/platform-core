import { notFound } from "next/navigation";

import { BackLink } from "@/components/layout/BackLink";
import { GroupedCatalog } from "@/components/resources/GroupedCatalog";
import { ResourceListView } from "@/components/resources/ResourceListView";
import { requireSession } from "@/core/auth/session";
import { getResourceCapability } from "@/core/resources/capabilities-client";
import { getPermissionsCatalog } from "@/core/resources/permissions-catalog-client";

type PageProps = {
  params: Promise<{ resourceName: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function ResourcePage({ params, searchParams }: PageProps) {
  await requireSession();
  const { resourceName } = await params;
  const rawSearchParams = await searchParams;

  const capability = await getResourceCapability(resourceName);
  if (!capability) {
    notFound();
  }

  if (capability.view === "grouped_catalog") {
    const catalog = await getPermissionsCatalog(capability.api_path);
    if (!catalog) {
      notFound();
    }
    return (
      <div className="space-y-4">
        <BackLink href="/resources" label="Recursos" />
        <h1 className="text-xl font-semibold text-slate-900">{capability.label}</h1>
        <GroupedCatalog label={capability.label} catalog={catalog} />
      </div>
    );
  }

  if (capability.view !== "table" || !capability.list) {
    notFound();
  }

  return (
    <div className="space-y-4">
      <BackLink href="/resources" label="Recursos" />
      <ResourceListView
        capability={capability}
        basePath={`/resources/${encodeURIComponent(resourceName)}`}
        rawSearchParams={rawSearchParams}
      />
    </div>
  );
}
