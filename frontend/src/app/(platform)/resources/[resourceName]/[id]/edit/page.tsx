import { notFound } from "next/navigation";

import { ResourceUpdateForm } from "@/components/resources/ResourceUpdateForm";
import { requireSession } from "@/core/auth/session";
import { getResourceCapability } from "@/core/resources/capabilities-client";
import { fillPlaceholder } from "@/core/resources/item-reference";
import { getResourceDetail } from "@/core/resources/resource-detail-client";
import { assertSupportedUpdateForm } from "@/core/resources/resource-form";

type PageProps = {
  params: Promise<{ resourceName: string; id: string }>;
};

/**
 * Edición genérica guiada por capability. El segmento ``id`` es el valor de la
 * referencia del item; las URLs (detail, update) se construyen sustituyendo el
 * ``placeholder`` declarado por ``item_reference``, nunca asumiendo "id".
 *
 * notFound si falta item_reference, detail o forms.update, o si el detalle no es
 * accesible. Los valores iniciales provienen del detalle (fuente de verdad), no de
 * la fila de tabla.
 */
export default async function EditResourcePage({ params }: PageProps) {
  await requireSession();
  const { resourceName, id } = await params;

  const capability = await getResourceCapability(resourceName);
  if (
    !capability ||
    capability.view !== "table" ||
    !capability.item_reference ||
    !capability.detail ||
    !capability.forms?.update
  ) {
    notFound();
  }

  assertSupportedUpdateForm(capability.forms.update);

  const placeholder = capability.item_reference.placeholder;
  const detailUrl = fillPlaceholder(capability.detail.url_template, placeholder, id);
  const mutationUrl = fillPlaceholder(capability.forms.update.url_template, placeholder, id);

  const detail = await getResourceDetail(detailUrl);
  if (!detail) {
    notFound();
  }

  return (
    <ResourceUpdateForm
      resourceName={resourceName}
      resourceLabel={capability.label}
      update={capability.forms.update}
      mutationUrl={mutationUrl}
      initialValues={detail}
    />
  );
}
