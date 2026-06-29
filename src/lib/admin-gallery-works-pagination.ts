export interface AdminGalleryWorksPagination {
  page: number;
  pageSize: number;
  limit: number;
  offset: number;
}

export interface AdminGalleryWorksPaginationMetaInput {
  total: number;
  page: number;
  pageSize: number;
  resultCount: number;
  offset?: number;
}

function intParam(value: string | null, fallback: number, min: number, max: number) {
  const parsed = Number.parseInt(value || '', 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

export function parseAdminGalleryWorksPagination(params: URLSearchParams): AdminGalleryWorksPagination {
  const hasPage = params.has('page');
  const pageSize = intParam(params.get('pageSize') || params.get('limit'), 20, 1, 100);
  const offset = hasPage
    ? (intParam(params.get('page'), 1, 1, 50000) - 1) * pageSize
    : intParam(params.get('offset'), 0, 0, 1000000);
  const page = Math.floor(offset / pageSize) + 1;

  return {
    page,
    pageSize,
    limit: pageSize,
    offset,
  };
}

export function buildAdminGalleryWorksPaginationMeta(input: AdminGalleryWorksPaginationMetaInput) {
  const total = Math.max(0, Number(input.total || 0));
  const pageSize = Math.max(1, Number(input.pageSize || 20));
  const page = Math.max(1, Number(input.page || 1));
  const offset = Math.max(0, Number(input.offset ?? ((page - 1) * pageSize)));
  const resultCount = Math.max(0, Number(input.resultCount || 0));
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const nextOffset = offset + resultCount;

  return {
    total,
    page,
    pageSize,
    totalPages,
    nextOffset,
    hasMore: nextOffset < total,
  };
}
