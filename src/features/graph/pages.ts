import { PAGE_SIZE } from "@/ipc/queries";

export function pageOf(index: number, pageSize = PAGE_SIZE): number {
  return Math.floor(index / pageSize);
}

export function pageCount(rowCount: number, pageSize = PAGE_SIZE): number {
  return Math.ceil(rowCount / pageSize);
}

/** Pages covering [first, last], extended by `prefetch` neighbours each side and clamped to the graph. */
export function pagesForRange(
  first: number,
  last: number,
  rowCount: number,
  prefetch = 1,
  pageSize = PAGE_SIZE,
): number[] {
  if (rowCount <= 0 || last < first) return [];
  const total = pageCount(rowCount, pageSize);
  const lo = Math.max(0, pageOf(Math.max(0, first), pageSize) - prefetch);
  const hi = Math.min(total - 1, pageOf(Math.min(rowCount - 1, last), pageSize) + prefetch);
  const pages: number[] = [];
  for (let p = lo; p <= hi; p++) pages.push(p);
  return pages;
}
