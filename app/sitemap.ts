/**
 * Sitemap.
 *
 * A discovery product that Google cannot crawl is a contradiction, but an
 * honest sitemap is bounded: it lists the static surfaces, the category
 * pages, and agent cards that have EARNED indexing - VERIFIED and LISTED
 * only, the ones whose liveness has been probed. A sitemap of 100k+
 * DORMANT cards would point crawlers at unmeasured claims, which is exactly
 * what the registry itself does and what this product corrects.
 *
 * Regenerated hourly: the verified set changes with every probe wave.
 */
import type { MetadataRoute } from "next";
import postgres from "postgres";
import { CATEGORIES } from "@/lib/data";

export const revalidate = 3600;

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? "https://gebo-bsc.vercel.app";
const MAX_AGENT_URLS = 5000;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const entries: MetadataRoute.Sitemap = [
    { url: `${SITE}/`, changeFrequency: "hourly", priority: 1 },
    { url: `${SITE}/categories`, changeFrequency: "daily", priority: 0.8 },
    { url: `${SITE}/search`, changeFrequency: "daily", priority: 0.8 },
    { url: `${SITE}/shortlist`, changeFrequency: "weekly", priority: 0.6 },
    { url: `${SITE}/compare`, changeFrequency: "daily", priority: 0.6 },
    { url: `${SITE}/live`, changeFrequency: "hourly", priority: 0.7 },
    { url: `${SITE}/methodology`, changeFrequency: "weekly", priority: 0.5 },
    { url: `${SITE}/authority`, changeFrequency: "weekly", priority: 0.5 },
    { url: `${SITE}/llms.txt`, changeFrequency: "weekly", priority: 0.4 },
  ];

  for (const slug of Object.keys(CATEGORIES)) {
    entries.push({ url: `${SITE}/c/${slug}`, changeFrequency: "daily", priority: 0.7 });
  }

  const url = process.env.DATABASE_URL;
  if (url) {
    const sql = postgres(url, { prepare: false, max: 1, connect_timeout: 10, onnotice: () => {} });
    try {
      /**
       * The query is raced against a short clock: this function runs at
       * BUILD time (ISR prerender), and an unbounded DB read there fails the
       * whole deploy - found 2026-09-08 when the throttled free tier held
       * the sitemap query past Vercel's 60s page-data deadline ("Failed to
       * build /sitemap.xml: attempt 1 of 3"), which would have blocked every
       * auto-deploy until the DB recovered. Builds must never depend on
       * database latency; the runtime revalidation (hourly, on request)
       * picks the verified set up again once the read succeeds.
       */
      const SITEMAP_QUERY_BUDGET_MS = 8_000;
      const rows = await Promise.race([
        sql<{ token_id: string; updated: string }[]>`
          select token_id::text as token_id, updated_at::text as updated
          from agents
          where chain_id = 56 and trust_state in ('VERIFIED', 'LISTED')
          order by updated_at desc
          limit ${MAX_AGENT_URLS}`,
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("sitemap query budget exceeded")), SITEMAP_QUERY_BUDGET_MS),
        ),
      ]);
      for (const r of rows) {
        entries.push({
          url: `${SITE}/a/${r.token_id}`,
          lastModified: new Date(r.updated),
          changeFrequency: "daily",
          priority: 0.6,
        });
      }
    } catch {
      // A sitemap that cannot read the verified set ships the static entries
      // rather than nothing - absent, not fabricated.
    } finally {
      await sql.end({ timeout: 5 }).catch(() => {});
    }
  }

  return entries;
}
