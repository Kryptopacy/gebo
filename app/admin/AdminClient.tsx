"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

/** Auto-refresh the server component's data without a full page reload. */
export function AutoRefresh({ seconds = 60 }: { seconds?: number }) {
  const router = useRouter();
  const [on, setOn] = useState(true);
  useEffect(() => {
    if (!on) return;
    const t = setInterval(() => router.refresh(), seconds * 1000);
    return () => clearInterval(t);
  }, [on, router, seconds]);
  return (
    <button type="button" className="btn-quiet" onClick={() => setOn((v) => !v)}>
      {on ? `auto-refresh ${seconds}s: on` : "auto-refresh: off"}
    </button>
  );
}

const RESULT_MAX = 900;

/** Manual run-now button for a cron route, via the admin-trigger proxy. */
export function TriggerButton({ job }: { job: string }) {
  const [state, setState] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    setState("running…");
    try {
      const res = await fetch("/api/admin/trigger", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ job }),
      });
      const j = await res.json();
      const body = JSON.stringify(j.body ?? j.error ?? j);
      setState(`${j.ok ? "ok" : "FAILED"} — ${body.length > RESULT_MAX ? body.slice(0, RESULT_MAX) + "…" : body}`);
    } catch (e: any) {
      setState(`error: ${String(e?.message ?? e)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="trigger-wrap">
      <button type="button" className="btn-quiet" onClick={run} disabled={busy}>
        {busy ? "running…" : `run ${job} now`}
      </button>
      {state && <pre className="trigger-result">{state}</pre>}
    </div>
  );
}

export function LogoutButton() {
  const router = useRouter();
  return (
    <button
      type="button"
      className="btn-quiet"
      onClick={async () => {
        await fetch("/api/admin/logout", { method: "POST" });
        router.push("/admin/login");
      }}
    >
      sign out
    </button>
  );
}
