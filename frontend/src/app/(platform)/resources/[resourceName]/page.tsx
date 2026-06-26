import { notFound } from "next/navigation";

import { ResourcePagination } from "@/components/resources/ResourcePagination";
import { ResourceSearchForm } from "@/components/resources/ResourceSearchForm";
import { ResourceTable } from "@/components/resources/ResourceTable";
import { requireSession } from "@/core/auth/session";
import { getResourceCapability } from "@/core/resources/capabilities-client";
import {
  buildPageHref,
  buildSortHref,
  parseListQuery,
  parseSearchField,
} from "@/core/resources/list-query";
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
  if (!capability || capability.view !== "table" || !capability.list) {
    notFound();
  }
  const list = capability.list;

  const query = parseListQuery(rawSearchParams, list);
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
      ? buildPageHref(basePath, query, pagination.offset - pagination.limit)
      : undefined;
  const nextHref = pagination.has_next
    ? buildPageHref(basePath, query, pagination.offset + pagination.limit)
    : undefined;

  return (
    <div className="space-y-4">
      <ResourceSearchForm
        action={basePath}
        search={list.search}
        value={search.value}
        tooShort={search.tooShort}
        sortParam={sortParam}
        limit={query.limit}
      />
      <ResourceTable
        label={capability.label}
        list={list}
        page={page}
        explicitSort={query.sort}
        buildSortHref={(fieldName) => buildSortHref(basePath, query, fieldName)}
      />
      <ResourcePagination prevHref={prevHref} nextHref={nextHref} pagination={pagination} />
    </div>
  );
}
