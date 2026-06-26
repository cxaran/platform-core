import { notFound } from "next/navigation";
import Link from "next/link";

import { GroupedCatalog } from "@/components/resources/GroupedCatalog";
import { ResourceListControls } from "@/components/resources/ResourceListControls";
import { ResourcePagination } from "@/components/resources/ResourcePagination";
import { ResourceTable } from "@/components/resources/ResourceTable";
import { requireSession } from "@/core/auth/session";
import { getResourceCapability } from "@/core/resources/capabilities-client";
import {
  buildFilterableControls,
  buildPageHref,
  buildSortHref,
  parseListQuery,
  parseSearchField,
} from "@/core/resources/list-query";
import { getPermissionsCatalog } from "@/core/resources/permissions-catalog-client";
import { getResourceListPage } from "@/core/resources/resource-list-client";

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
  const sortParam = query.sort
    ? `${query.sort.direction === "desc" ? "-" : ""}${query.sort.field}`
    : undefined;

  const { pagination } = page;
  const prevHref =
    pagination.offset > 0
      ? buildPageHref(basePath, query, controls, pagination.offset - pagination.limit)
      : undefined;
  const nextHref = pagination.has_next
    ? buildPageHref(basePath, query, controls, pagination.offset + pagination.limit)
    : undefined;

  return (
    <div className="space-y-4">
      {capability.forms?.create ? (
        <div className="flex justify-end">
          <Link
            href={`${basePath}/new`}
            className="rounded-md bg-slate-950 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-800"
          >
            Nuevo
          </Link>
        </div>
      ) : null}
      <ResourceListControls
        resourceName={resourceName}
        search={list.search}
        controls={controls}
        filters={query.filters}
        searchValue={search.value}
        searchTooShort={search.tooShort}
        sortParam={sortParam}
        limit={query.limit}
      />
      <ResourceTable
        label={capability.label}
        list={list}
        page={page}
        explicitSort={query.sort}
        buildSortHref={(fieldName) => buildSortHref(basePath, query, controls, fieldName)}
        resourceName={resourceName}
        relations={capability.relations ?? []}
        actions={capability.actions ?? []}
        itemReference={capability.item_reference ?? null}
        editEnabled={Boolean(
          capability.item_reference && capability.detail && capability.forms?.update,
        )}
      />
      <ResourcePagination prevHref={prevHref} nextHref={nextHref} pagination={pagination} />
    </div>
  );
}
