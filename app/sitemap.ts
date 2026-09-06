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
      const rows = await sql<{ token_id: string; updated: string }[]>`
        select token_id::text as token_id, updated_at::text as updated
        from agents
        where chain_id = 56 and trust_state in ('VERIFIED', 'LISTED')
        order by updated_at desc
        limit ${MAX_AGENT_URLS}`;
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
