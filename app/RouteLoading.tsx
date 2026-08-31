/**
 * Route-level loading state: the GEBO mark spinning over a one-line label.
 *
 * Every data page here is force-dynamic and reads Postgres plus, on some
 * routes, chain state before it can render a single honest number - which
 * means navigation has real latency that used to render as a frozen previous
 * page. The App Router loading boundary swaps this in immediately instead.
 *
 * Motion is gated on prefers-reduced-motion (site convention for non-essential
 * animation): reduced-motion users get the same mark, still, with the label
 * doing the explaining.
 */
export default function RouteLoading({ label }: { label: string }) {
  return (
    <section className="band">
      <div className="shell">
        <div className="route-loading" role="status" aria-label={label}>
          <img src="/gebo-mark.png" alt="" width={40} height={40} className="route-loading-mark" />
          <p className="route-loading-label">{label}</p>
        </div>
      </div>
    </section>
  );
}
