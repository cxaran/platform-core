import { notFound } from "next/navigation";

import { RelationEditor } from "@/components/resources/RelationEditor";
import { requireSession } from "@/core/auth/session";
import { getRelationEditorData } from "@/core/resources/relation-editor-client";

type PageProps = {
  params: Promise<{ resourceName: string; id: string; relationName: string }>;
};

/**
 * Editor relacional dedicado, guiado por capability: solo se resuelve si el backend
 * publica el editor (el actor puede leer el recurso y editar la relación). Toda la
 * autoridad (supervivencia administrativa, invalidación de sesiones) vive en el
 * backend; aquí no se infieren rutas, ids ni permisos.
 */
export default async function RelationEditorPage({ params }: PageProps) {
  await requireSession();
  const { resourceName, id, relationName } = await params;

  const data = await getRelationEditorData(resourceName, id, relationName);
  if (!data) {
    notFound();
  }

  const listPath = `/resources/${encodeURIComponent(resourceName)}`;

  return (
    <RelationEditor
      title={data.relation.label}
      description={data.relation.description}
      groups={data.groups}
      initialSelected={data.selected}
      mutationUrl={data.mutationUrl}
      mutationMethod={data.relation.mutation_method}
      requestField={data.relation.request_field}
      listPath={listPath}
    />
  );
}
