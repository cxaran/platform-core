import { notFound } from "next/navigation";
import { cookies } from "next/headers";
import Link from "next/link";

import { BackLink } from "@/components/layout/BackLink";
import { BulkActionsBar } from "@/components/resources/BulkActionsBar";
import { GroupedCatalog } from "@/components/resources/GroupedCatalog";
import { hiddenColumnsCookieName } from "@/components/resources/filter-nav";
import { ResourcePagination } from "@/components/resources/ResourcePagination";
import { ResourceTable } from "@/components/resources/ResourceTable";
import { ResourceToolbar } from "@/components/resources/ResourceToolbar";
import { RowSelectionProvider } from "@/components/resources/RowSelection";
import { TableTotals } from "@/components/resources/TableTotals";
import { requireSession } from "@/core/auth/session";
import { getResourceCapability } from "@/core/resources/capabilities-client";
import {
  buildFilterableControls,
  buildListHref,
  buildListSearchParams,
  buildPageHref,
  buildSortHref,
  parseListQuery,
  parseSearchField,
} from "@/core/resources/list-query";
import { getPermissionsCatalog } from "@/core/resources/permissions-catalog-client";
import { getResourceListPage } from "@/core/resources/resource-list-client";
import { getResourceStats } from "@/core/resources/stats-data";

type PageProps = {
  params: Promise<{ resourceName: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

// Etiqueta visible del paciente para el chip de contexto activo, tomada de la propia fila (el médico
// ya la ve en la tabla). Cae a un texto neutro si no hay un campo de nombre.

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
  const list = capability.list;

  // Capability inválida → FilterableContractError → error boundary (no notFound).
  const controls = buildFilterableControls(list);
  const query = parseListQuery(rawSearchParams, list, controls);
  const page = await getResourceListPage(capability, query);
  if (!page) {
    notFound();
  }

  const basePath = `/resources/${encodeURIComponent(resourceName)}`;
  const search = parseSearchField(rawSearchParams, list);

  const { pagination } = page;
  const createHref = capability.forms?.create ? `${basePath}/new` : undefined;
  // Filtros/búsqueda ACTIVOS del usuario → el estado vacío ofrece limpiarlos
  // (se preservan sort y limit; offset vuelve a 0).
  const hasActiveFilters = query.q !== undefined || Object.keys(query.filters).length > 0;
  const clearFiltersHref = buildListHref(
    basePath,
    { q: undefined, sort: query.sort, limit: query.limit, offset: 0, filters: {} },
    controls,
  );

  // Estado canónico serializable: las islas (búsqueda, filtros) reconstruyen URLs
  // a partir de él sin recibir funciones del server.
  const canonicalParams = Object.fromEntries(buildListSearchParams(query, controls));

  // Columnas ocultas por el usuario (cookie por recurso; el server renderiza ya
  // sin ellas, cero parpadeo). Se valida contra las columnas reales del contrato.
  const listColumns = list.fields
    .filter((field) => field.visible_in_list)
    .map((field) => ({ name: field.name, label: field.label }));
  const columnNames = new Set(listColumns.map((column) => column.name));
  const cookieStore = await cookies();
  const rawHidden = cookieStore.get(hiddenColumnsCookieName(resourceName))?.value ?? "";
  const hiddenColumns = decodeURIComponent(rawHidden)
    .split(",")
    .filter((name) => columnNames.has(name));

  const fieldsByColumn = Object.fromEntries(
    controls.ordered.map((field) => [field.key, field]),
  );

  // Edición de celdas en sitio: solo si el contrato proyecta el formulario de
  // actualización (RBAC ya aplicado) y hay identidad por item. Las columnas
  // editables son la intersección columnas visibles ∩ campos del form.
  const updateForm = capability.forms?.update;
  const inlineEdit =
    updateForm && capability.item_reference
      ? {
          urlTemplate: updateForm.url_template,
          method: updateForm.method,
          fields: Object.fromEntries(
            updateForm.fields
              .filter((field) => field.editable)
              .map((field) => [field.name, field]),
          ),
        }
      : undefined;

  // Totales del pie (backend, bajo el filtro activo) para columnas numéricas
  // agregables VISIBLES. Es un realce: si falla, la tabla sale sin pie.
  const hiddenSet = new Set(hiddenColumns);
  const aggregableColumns = list.fields.filter(
    (field) => field.aggregable && field.visible_in_list && !hiddenSet.has(field.name),
  );
  const stats =
    list.stats_url && aggregableColumns.length > 0
      ? await getResourceStats(
          list.stats_url,
          aggregableColumns.map((field) => field.name),
          query,
          controls,
        )
      : null;

  // Selección múltiple: filas de la página actual con su id (para rango con
  // Shift y para el TSV/lote). Requiere identidad por item.
  const idField = capability.item_reference?.field ?? "id";
  const selectableRows = capability.item_reference
    ? page.items.flatMap((row) => {
        const rawId = row[idField];
        return typeof rawId === "string" && rawId !== "" ? [{ id: rawId, row }] : [];
      })
    : [];
  const selectable = selectableRows.length > 0;
  const visibleColumnsMeta = listColumns.filter((column) => !hiddenSet.has(column.name));

  return (
    <div className="space-y-4">
      <BackLink href="/resources" label="Recursos" />
      <ResourceToolbar
        label={capability.label}
        resourceName={resourceName}
        basePath={basePath}
        params={canonicalParams}
        fields={controls.ordered}
        filters={query.filters}
        search={{
          enabled: list.search.enabled,
          value: search.value,
          minLength: Math.max(list.search.min_length ?? 0, 1),
          maxLength: list.search.max_length ?? undefined,
        }}
        columns={listColumns}
        hiddenColumns={hiddenColumns}
        facetsUrl={list.facets_url ?? undefined}
        actions={
          createHref ? (
            <Link
              href={createHref}
              className="inline-flex h-9 items-center rounded-[10px] bg-[var(--accent)] px-4 text-[13px] font-semibold text-[var(--on-accent)] shadow-[var(--soft)] transition hover:brightness-105"
            >
              Nuevo
            </Link>
          ) : null
        }
      />
      <RowSelectionProvider rows={selectableRows}>
        {selectable ? (
          <BulkActionsBar
            columns={visibleColumnsMeta}
            actions={capability.actions ?? []}
            placeholder={capability.item_reference?.placeholder ?? "id"}
          />
        ) : null}
        <ResourceTable
        label=""
        list={list}
        page={page}
        explicitSort={query.sort}
        buildSortHref={(fieldName) => buildSortHref(basePath, query, controls, fieldName)}
        resourceName={resourceName}
        relations={capability.relations ?? []}
        actions={capability.actions ?? []}
        relatedLists={capability.related_lists ?? []}
        itemReference={capability.item_reference ?? null}
        editEnabled={Boolean(
          capability.item_reference && capability.detail && capability.forms?.update,
        )}
        detailEnabled={Boolean(capability.item_reference && capability.detail)}
        hasActiveFilters={hasActiveFilters}
        clearFiltersHref={clearFiltersHref}
        createHref={createHref}
        maxHeightClassName="max-h-[70vh]"
        hiddenColumns={hiddenColumns}
        headerFilters={{
          basePath,
          params: canonicalParams,
          fields: fieldsByColumn,
          facetsUrl: list.facets_url ?? undefined,
        }}
        inlineEdit={inlineEdit}
        selectable={selectable}
        />
      </RowSelectionProvider>
      {stats ? <TableTotals stats={stats} columns={aggregableColumns} /> : null}
      <ResourcePagination
        pagination={pagination}
        buildOffsetHref={(offset) => buildPageHref(basePath, query, controls, offset)}
        buildLimitHref={(limit) =>
          buildListHref(basePath, { ...query, limit, offset: 0 }, controls)
        }
        maxLimit={list.pagination.max_limit}
      />
    </div>
  );
}
