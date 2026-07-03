"use client";

import { useEffect, useState } from "react";

import { relationItemLabel, type RelationTarget } from "@/core/resources/relation-picker";
import { fetchRelationItem, fetchRelationMeta } from "@/core/resources/relation-search-client";

/**
 * Etiqueta HUMANA de un campo FK en la página de detalle (solo lectura). Reusa la misma capa que
 * el selector de relación (F5): resuelve la metadata del recurso destino y lee el item por su id
 * (``fetchRelationItem``) para mostrar su nombre (paciente/médico/consulta) en vez del UUID.
 *
 * Degradación honesta: sin permiso de lectura individual o item inexistente, se queda con el UUID
 * (nunca inventa una etiqueta). No emite ningún control editable: es sólo texto.
 */
export function RelationLabel({
  target,
  value,
}: Readonly<{
  target: RelationTarget;
  value: string | null;
}>) {
  const [label, setLabel] = useState<string | null>(null);

  useEffect(() => {
    if (!value) {
      return;
    }
    let active = true;
    void fetchRelationMeta(target.resource)
      .then((meta) => fetchRelationItem(meta.apiPath, value))
      .then((item) => {
        if (active && item) {
          setLabel(relationItemLabel(item, target));
        }
      })
      .catch(() => {
        // Sin permiso / inexistente: se conserva el UUID como respaldo.
      });
    return () => {
      active = false;
    };
  }, [target, value]);

  if (!value) {
    return <span className="text-slate-400">—</span>;
  }
  return <span className="text-slate-900">{label ?? value}</span>;
}
