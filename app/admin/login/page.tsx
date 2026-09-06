"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function AdminLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const j = await res.json();
      if (res.ok && j.ok) {
        router.push("/admin");
        router.refresh();
      } else {
        setError(String(j.error ?? "login failed"));
      }
    } catch (err: any) {
      setError(String(err?.message ?? err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="band-tight">
      <div className="shell" style={{ maxWidth: "460px" }}>
        <p className="crumb"><a href="/">GEBO</a> <span className="t-4">/</span> Ops</p>
        <h1 style={{ fontSize: "clamp(1.6rem, 3vw, 2.1rem)" }}>Sign in</h1>
        <p className="prose sm mt-s">
          Single-admin operations console. The address is allowlisted; the password is
          ADMIN_PASSWORD, and login refuses (rather than opens) when it is unset.
        </p>
        <form onSubmit={submit} className="mt-m" style={{ display: "grid", gap: "12px" }}>
          <label style={{ display: "grid", gap: "4px" }}>
            <span className="prose sm">Email</span>
            <input
              type="email" value={email} required autoComplete="username"
              onChange={(e) => setEmail(e.target.value)}
              style={{ padding: "9px 11px", borderRadius: "8px", border: "1px solid var(--rule)" }}
            />
          </label>
          <label style={{ display: "grid", gap: "4px" }}>
            <span className="prose sm">Password</span>
            <input
              type="password" value={password} required autoComplete="current-password"
              onChange={(e) => setPassword(e.target.value)}
              style={{ padding: "9px 11px", borderRadius: "8px", border: "1px solid var(--rule)" }}
            />
          </label>
          <button type="submit" className="btn-quiet" disabled={busy} style={{ justifySelf: "start" }}>
            {busy ? "checking…" : "sign in"}
          </button>
          {error && (
            <p className="prose sm" style={{ color: "var(--fail)" }}>{error}</p>
          )}
        </form>
      </div>
    </section>
  );
}
