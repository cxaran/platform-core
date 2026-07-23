import Link from "next/link";
import { notFound } from "next/navigation";

import { BackLink } from "@/components/layout/BackLink";
import { ResourceDetailFields } from "@/components/resources/ResourceDetailFields";
import { ResourceRowActions } from "@/components/resources/ResourceRowActions";
import { requireSession } from "@/core/auth/session";
import { getResourceCapability } from "@/core/resources/capabilities-client";
import { fillPlaceholder } from "@/core/resources/item-reference";
import { getResourceDetail } from "@/core/resources/resource-detail-client";
import { displayFields } from "@/core/resources/resource-detail-view";
import { visibleActionsForRow } from "@/core/resources/resource-action";

type PageProps = {
  params: Promise<{ resourceName: string; id: string }>;
};

/**
 * Detalle de SOLO LECTURA de un recurso, guiado por capability. Muestra TODOS los campos con la misma
 * metadata que usa la edición, sin un solo input. Las acciones de cabecera (Editar, sub-pantallas
 * relacionales, acciones de fila, descarga) sólo aparecen si el contrato las trae para el actor:
 * el backend ya filtra la capability por permiso, así que reusar esas señales = mismo RBAC que la
 * lista. El segmento ``id`` es el valor de la referencia del item; las URLs se arman sustituyendo
 * el ``placeholder`` declarado por ``item_reference``, nunca asumiendo "id".
 */
export default async function ResourceDetailPage({ params }: PageProps) {
  await requireSession();
  const { resourceName, id } = await params;

  const capability = await getResourceCapability(resourceName);
  if (
    !capability ||
    capability.view !== "table" ||
    !capability.item_reference ||
    !capability.detail
  ) {
    notFound();
  }

  const placeholder = capability.item_reference.placeholder;
  const detailUrl = fillPlaceholder(capability.detail.url_template, placeholder, id);

  const detail = await getResourceDetail(detailUrl);
  if (!detail) {
    notFound();
  }

  const base = `/resources/${encodeURIComponent(resourceName)}/${encodeURIComponent(id)}`;
  const fields = displayFields(capability);

  // Misma señal RBAC que la lista: el botón de editar sólo si hay forma de actualización
  // (el backend la omite cuando el actor no puede editar).
  const editEnabled = Boolean(capability.forms?.update);
  // Relaciones y acciones llegan ya filtradas por permiso desde el backend.
  const relations = capability.relations ?? [];
  const actions = capability.actions ?? [];
  const rowActions = visibleActionsForRow(actions, detail);
  // Descarga de binario sólo si el actor tiene el permiso (capability presente).
  const downloadUrl = capability.file_download
    ? fillPlaceholder(capability.file_download.url_template, placeholder, id)
    : null;

  const listPath = `/resources/${encodeURIComponent(resourceName)}`;

  return (
    <div className="space-y-6">
      <BackLink href={listPath} label={capability.label} />
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm text-slate-500">{capability.label}</p>
          <h1 className="text-xl font-semibold text-slate-900">Detalle</h1>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {editEnabled ? (
            <Link
              href={`${base}/edit`}
              className="rounded-md bg-slate-950 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-800"
            >
              Editar
            </Link>
          ) : null}
          {relations.map((relation) => (
            <Link
              key={relation.name}
              href={`${base}/${encodeURIComponent(relation.name)}`}
              className="text-sm font-medium text-slate-700 underline-offset-2 hover:text-slate-900 hover:underline"
            >
              {relation.label}
            </Link>
          ))}
          {downloadUrl ? (
            <a
              href={downloadUrl}
              className="text-sm font-medium text-slate-700 underline-offset-2 hover:text-slate-900 hover:underline"
            >
              Descargar archivo
            </a>
          ) : null}
          {rowActions.length > 0 ? (
            <ResourceRowActions
              placeholder={placeholder}
              id={id}
              actions={rowActions}
              item={detail}
            />
          ) : null}
        </div>
      </div>

      <section className="rounded-lg border border-slate-200 bg-white p-6">
        <ResourceDetailFields fields={fields} values={detail} />
      </section>

      {/* Documento de AUDIO: transcripción LOCAL en el navegador (el audio no sale del
          dispositivo). El texto es un borrador que el médico revisa y puede usar para una nota. */}
    </div>
  );
}
