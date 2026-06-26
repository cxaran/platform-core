import { notFound } from "next/navigation";

import { ResourceCreateForm } from "@/components/resources/ResourceCreateForm";
import { requireSession } from "@/core/auth/session";
import { getResourceCapability } from "@/core/resources/capabilities-client";
import { assertSupportedCreateForm } from "@/core/resources/resource-form";

type PageProps = {
  params: Promise<{ resourceName: string }>;
};

export default async function NewResourcePage({ params }: PageProps) {
  await requireSession();
  const { resourceName } = await params;

  const capability = await getResourceCapability(resourceName);
  if (!capability || capability.view !== "table" || !capability.forms?.create) {
    notFound();
  }

  assertSupportedCreateForm(capability.forms.create);

  return (
    <ResourceCreateForm
      resourceName={resourceName}
      resourceLabel={capability.label}
      create={capability.forms.create}
    />
  );
}
