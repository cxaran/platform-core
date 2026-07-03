/**
 * Navegación de filtros: reescribe query params sobre el estado canónico actual
 * (el record viene de ``buildListSearchParams``, o sea ya validado). Puro y sin
 * dependencias: lo usan tanto el server (chips como Links) como las islas de
 * cliente (aplicar/limpiar filtros, búsqueda con debounce).
 *
 * Un update con valor null o vacío ELIMINA el parámetro. Cualquier cambio de
 * filtros/búsqueda reinicia el offset a 0.
 */
export function hrefWithParamUpdates(
  basePath: string,
  params: Readonly<Record<string, string>>,
  updates: Readonly<Record<string, string | null>>,
): string {
  const next = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    next.set(key, value);
  }
  for (const [key, value] of Object.entries(updates)) {
    const trimmed = value?.trim() ?? "";
    if (trimmed === "") {
      next.delete(key);
    } else {
      next.set(key, trimmed);
    }
  }
  next.set("offset", "0");
  const qs = next.toString();
  return qs ? `${basePath}?${qs}` : basePath;
}

/**
 * Cookie POR RECURSO con las columnas ocultas. Vive aquí (módulo compartido,
 * sin "use client") porque la lee el server (page.tsx) y la escribe la isla
 * ColumnVisibilityMenu.
 */
export function hiddenColumnsCookieName(resourceName: string): string {
  return `rtcols_${resourceName}`;
}

/** Parámetros que un campo filtrable puede tener activos (incluye rangos). */
export function fieldParameterNames(field: {
  operators: readonly {
    parameterName?: string;
    fromParameter?: string;
    toParameter?: string;
  }[];
}): string[] {
  const names: string[] = [];
  for (const operator of field.operators) {
    for (const name of [operator.parameterName, operator.fromParameter, operator.toParameter]) {
      if (name) names.push(name);
    }
  }
  return names;
}
