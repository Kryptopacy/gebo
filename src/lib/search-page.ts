/**
 * Pure parameter handling for the search page: parsing, clamping, and URL
 * building for pagination, trust-state filters and sort. Extracted from the
 * page so the numbers on the page are testable without a database.
 *
 * Deep pages are capped deliberately: offset pagination past a few thousand
 * rows makes the database do work proportional to the offset for results
 * nobody reaches (the pattern behind every major search engine's "refine
 * your query" wall). The cap is disclosed, never silent.
 */
import { SEARCH_TRUST_STATES, type SearchSort, type TrustStateFilter } from "./data.ts";

export const PAGE_SIZE = 60;
export const MAX_PAGES = 20;

export type SearchPageParams = {
  q: string;
  page: number;
  state: TrustStateFilter | null;
  sort: SearchSort;
};

export function parseSearchParams(raw: { q?: string; page?: string; state?: string; sort?: string }): SearchPageParams {
  const q = (raw.q ?? "").trim().slice(0, 200);
  const page = Math.max(1, Math.floor(Number(raw.page)) || 1);
  const state = SEARCH_TRUST_STATES.includes(raw.state as TrustStateFilter) ? (raw.state as TrustStateFilter) : null;
  const sort: SearchSort = raw.sort === "newest" ? "newest" : "trusted";
  return { q, page, state, sort };
}

/** Total pages, capped at MAX_PAGES; 0 matches is 0 pages, not 1. */
export function totalPages(total: number): number {
  if (total <= 0) return 0;
  return Math.min(Math.ceil(total / PAGE_SIZE), MAX_PAGES);
}

export function clampPage(page: number, total: number): number {
  const pages = totalPages(total);
  if (pages === 0) return 1;
  return Math.min(Math.max(1, page), pages);
}

export function offsetFor(page: number): number {
  return (page - 1) * PAGE_SIZE;
}

/** Whether the cap hid results the user can only reach by refining. */
export function hiddenByCap(total: number): number {
  const visible = totalPages(total) * PAGE_SIZE;
  return Math.max(0, total - visible);
}

function href(p: SearchPageParams): string {
  const params = new URLSearchParams();
  if (p.q) params.set("q", p.q);
  if (p.state) params.set("state", p.state);
  if (p.sort === "newest") params.set("sort", "newest");
  if (p.page > 1) params.set("page", String(p.page));
  const s = params.toString();
  return s ? `/search?${s}` : "/search";
}

export function pageHref(p: SearchPageParams, page: number): string {
  return href({ ...p, page });
}

/** Filter links reset to page 1 - a filtered page 7 is a different list. */
export function stateHref(p: SearchPageParams, state: TrustStateFilter | null): string {
  return href({ ...p, state, page: 1 });
}

/** Sort links also reset: the page boundary means something different per sort. */
export function sortHref(p: SearchPageParams, sort: SearchSort): string {
  return href({ ...p, sort, page: 1 });
}
