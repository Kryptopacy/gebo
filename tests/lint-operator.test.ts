import { describe, it, expect } from "vitest";
import { lintUrl, lintRegistration } from "../src/lib/lint.ts";
import { registrableDomain, operatorOf } from "../src/lib/operator.ts";

/**
 * Registration linting exists because 18% of a sampled cohort registered an
 * endpoint URL containing an unsubstituted template variable, making them
 * uncallable by any client. Nothing else in the ecosystem flags that.
 */
describe("lintUrl", () => {
  it("catches an unsubstituted template variable", () => {
    const d = lintUrl("https://api.example.org/v1/a2a/agents/{agentId}/card");
    expect(d.some((x) => x.code === "template_var" && x.severity === "fatal")).toBe(true);
  });

  it("catches the other placeholder styles", () => {
    for (const url of [
      "https://x.io/agents/:agentId/card",
      "https://x.io/agents/<id>/card",
      "https://x.io/agents/${id}/card",
    ]) {
      expect(lintUrl(url).some((x) => x.code === "template_var")).toBe(true);
    }
  });

  it("catches hosts nobody else can reach", () => {
    expect(lintUrl("http://localhost:3000/a2a").some((x) => x.code === "loopback_host")).toBe(true);
    expect(lintUrl("http://127.0.0.1/a2a").some((x) => x.code === "loopback_host")).toBe(true);
    expect(lintUrl("http://10.0.0.5/a2a").some((x) => x.code === "private_host")).toBe(true);
    expect(lintUrl("http://192.168.1.9/a2a").some((x) => x.code === "private_host")).toBe(true);
  });

  it("treats a placeholder domain as fatal", () => {
    // example.com appeared as a production endpoint domain 20 times.
    expect(lintUrl("https://example.com/agent").some((x) => x.code === "placeholder_domain")).toBe(true);
  });

  it("treats a bare IP as major rather than fatal", () => {
    // Reachable, but with no TLS identity and no domain to verify ownership.
    const d = lintUrl("http://203.0.113.9/a2a");
    const ip = d.find((x) => x.code === "bare_ip");
    expect(ip?.severity).toBe("major");
  });

  it("rejects non-HTTP schemes", () => {
    expect(lintUrl("ftp://x.io/a").some((x) => x.code === "bad_scheme")).toBe(true);
  });

  it("passes a well-formed endpoint", () => {
    expect(lintUrl("https://agent.example.org/.well-known/agent-card.json")).toHaveLength(0);
  });
});

describe("lintRegistration", () => {
  it("marks an agent declaring no endpoint as unusable", () => {
    const r = lintRegistration({ name: "x", supported_trust_models: ["reputation"] } as never, []);
    expect(r.usable).toBe(false);
    expect(r.defects.some((d) => d.code === "no_endpoint")).toBe(true);
  });

  it("passes a clean registration", () => {
    const r = lintRegistration(
      { name: "Good Agent", supported_trust_models: ["reputation"] } as never,
      [{ kind: "a2a", url: "https://agent.example.org/card.json" }],
    );
    expect(r.usable).toBe(true);
  });

  it("notes a missing trust model without making it fatal", () => {
    const r = lintRegistration(
      { name: "x", supported_trust_models: [] } as never,
      [{ kind: "a2a", url: "https://agent.example.org/card.json" }],
    );
    expect(r.usable).toBe(true);
    expect(r.defects.some((d) => d.code === "no_trust_model" && d.severity === "minor")).toBe(true);
  });
});

/**
 * Operator identity is the project's central finding: one operator holds the
 * clear majority of endpoints on the chain, which is invisible if you group by
 * owner address. Getting this grouping wrong destroys the finding.
 */
describe("registrableDomain", () => {
  it("collapses subdomains to the registrable domain", () => {
    expect(registrableDomain("metadata.evoevo.ai")).toBe("evoevo.ai");
    expect(registrableDomain("api.v2.singularry.org")).toBe("singularry.org");
  });

  it("keeps the tenant label on shared platforms", () => {
    // Collapsing these would merge unrelated operators into one.
    expect(registrableDomain("bobbuildonbnb.vercel.app")).toBe("bobbuildonbnb.vercel.app");
    expect(registrableDomain("stockanalyst-agents.fly.dev")).toBe("stockanalyst-agents.fly.dev");
    expect(registrableDomain("x.workers.dev")).toBe("x.workers.dev");
  });

  it("handles multi-label public suffixes", () => {
    expect(registrableDomain("agent.example.co.uk")).toBe("example.co.uk");
  });

  it("passes bare IPs through unchanged", () => {
    expect(registrableDomain("172.104.171.139")).toBe("172.104.171.139");
  });

  it("is case-insensitive", () => {
    expect(registrableDomain("Metadata.EvoEvo.AI")).toBe("evoevo.ai");
  });
});

describe("operatorOf", () => {
  it("derives identity from the endpoint host, not the owner", () => {
    const op = operatorOf(
      { owner_address: "0xabc" } as never,
      [{ kind: "a2a", url: "https://metadata.evoevo.ai/agents/1" }],
    );
    expect(op.kind).toBe("host");
    expect(op.registrableDomain).toBe("evoevo.ai");
  });

  it("falls back to the owner when no endpoint parses", () => {
    const op = operatorOf({ owner_address: "0xABC" } as never, []);
    expect(op.kind).toBe("owner");
    expect(op.key).toBe("owner:0xabc");
  });

  it("reports unknown rather than inventing an operator", () => {
    expect(operatorOf({} as never, []).kind).toBe("unknown");
  });
});
