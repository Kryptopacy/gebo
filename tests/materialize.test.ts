/**
 * buildAgentFromRegistration is the pure mapping the materialize pipeline
 * runs for every new census row. Pinned here because it decides what a
 * freshly registered agent looks like on every surface: its name, its
 * endpoints, and the trust state it starts with before the prober speaks.
 */
import { describe, it, expect } from "vitest";
import { buildAgentFromRegistration, type Candidate } from "../src/lib/materialize.ts";

const CAND: Candidate = {
  token_id: "336715",
  owner: "0x67eE5d458890d66EAe0478d3306b37E548029F8d",
  uri_scheme: "https",
  token_uri: "https://example.com/reg.json",
};

describe("buildAgentFromRegistration", () => {
  it("maps registration fields onto the agent row", () => {
    const b = buildAgentFromRegistration(CAND, {
      name: "HealthGuard",
      description: "watches loan positions",
      x402Support: true,
      active: true,
      supportedTrust: ["evidence-backed"],
      services: [{ name: "a2a", endpoint: "https://agent.example.org/a2a", version: "0.2" }],
    }, CAND.token_uri);

    expect(b.agent.name).toBe("HealthGuard");
    expect(b.agent.description).toBe("watches loan positions");
    expect(b.agent.x402_supported).toBe(true);
    expect(b.agent.self_declared_active).toBe(true);
    expect(b.agent.supported_trust).toEqual(["evidence-backed"]);
    expect(b.agent.agent_id).toBe(`56:${b.agent.registry}:336715`);
    expect(b.agent.trust_state).toBe("DORMANT");
    expect(b.agent.trust_reason).toBe("not yet probed");
    expect(b.agent.lint_usable).toBe(true);
  });

  it("extracts endpoints with kind, host and version", () => {
    const b = buildAgentFromRegistration(CAND, {
      name: "Multi",
      services: [
        { name: "a2a", endpoint: "https://a2a.termix.live/x", version: "0.3" },
        { name: "MCP", endpoint: "https://mcp.termix.live/y" },
        { name: "web", endpoint: "https://termix.live/ui" },
        { name: "ignored-name", endpoint: "https://termix.live/other" },
      ],
    }, CAND.token_uri);

    expect(b.endpoints.map((e) => e.kind)).toEqual(["a2a", "mcp", "web"]);
    expect(b.endpoints[0]).toMatchObject({ host: "a2a.termix.live", version: "0.3" });
    // operator comes from the first hosted endpoint's registrable domain
    expect(b.operator?.key).toBe("host:termix.live");
    expect(b.agent.operator_key).toBe("host:termix.live");
  });

  it("shadows an agent whose only protocol endpoints are uncallable", () => {
    const b = buildAgentFromRegistration(CAND, {
      name: "Broken",
      services: [{ name: "a2a", endpoint: "https://good.example.org/agents/{agentId}/card" }],
    }, CAND.token_uri);

    expect(b.agent.trust_state).toBe("SHADOWED");
    expect(b.agent.trust_reason).toContain("unsubstituted template variable");
    expect(b.agent.lint_usable).toBe(false);
    expect(b.agent.lint_defects?.some((d) => d.code === "template_var")).toBe(true);
  });

  it("keeps a clean agent with a fatal web endpoint callable", () => {
    const b = buildAgentFromRegistration(CAND, {
      name: "Mixed",
      services: [
        { name: "a2a", endpoint: "https://good.example.org/a2a" },
        { name: "web", endpoint: "https://bad.example.org/ui/{userId}" },
      ],
    }, CAND.token_uri);

    // the a2a endpoint is clean, so the agent is callable and starts DORMANT
    expect(b.agent.trust_state).toBe("DORMANT");
    expect(b.agent.lint_usable).toBe(true);
  });

  it("states the empty case legibly rather than as a bare failure", () => {
    const b = buildAgentFromRegistration(CAND, { name: "NoServices" }, CAND.token_uri);
    expect(b.endpoints).toEqual([]);
    expect(b.agent.trust_state).toBe("DORMANT");
    expect(b.agent.trust_reason).toBe("declares no endpoint in its registration");
    expect(b.operator).toBeNull();
    expect(b.agent.operator_key).toBeNull();
  });

  it("never carries a null name through (candidates are pre-filtered, defence in depth)", () => {
    const b = buildAgentFromRegistration(CAND, { name: "   " }, CAND.token_uri);
    expect(b.agent.name).toBeNull();
  });
});
