import { describe, it, expect } from "vitest";
import { cardEndpointDefect } from "../src/lib/probe.ts";

/**
 * The endpoint an A2A card advertises.
 *
 * Found by measurement: two agents graded VERIFIED serve a well-formed card from a
 * public host and declare "url": "http://127.0.0.1:9104/" inside it. A2A clients
 * are meant to send message/send there, so nobody but the author's own machine can
 * hire them - and we called them VERIFIED because the CARD answered.
 *
 * lint.ts had treated a loopback host as fatal from the start. It was pointed at
 * the registry's declared endpoint, which is public and fine, while nothing checked
 * the address that actually matters for hiring. These tests keep that closed.
 */
describe("cardEndpointDefect", () => {
  it("rejects the loopback endpoint found in the live corpus", () => {
    const d = cardEndpointDefect("http://127.0.0.1:9104/");
    expect(d).toMatch(/loopback/);
    expect(cardEndpointDefect("http://localhost:9101/")).toMatch(/loopback/);
    expect(cardEndpointDefect("http://0.0.0.0:8080")).toMatch(/loopback/);
  });

  it("rejects RFC1918 addresses, which are unreachable from outside", () => {
    expect(cardEndpointDefect("http://10.0.0.5:3000/a2a")).toMatch(/private/);
    expect(cardEndpointDefect("http://192.168.1.20/a2a")).toMatch(/private/);
    expect(cardEndpointDefect("http://172.16.4.4/a2a")).toMatch(/private/);
    expect(cardEndpointDefect("http://169.254.1.1/a2a")).toMatch(/private/);
  });

  it("rejects local-only names", () => {
    expect(cardEndpointDefect("http://my-box.local:9000/")).toMatch(/local-only/);
  });

  it("rejects a non-HTTP scheme", () => {
    expect(cardEndpointDefect("ws://example.com/a2a")).toMatch(/not HTTP/);
    expect(cardEndpointDefect("file:///etc/passwd")).toMatch(/not HTTP/);
  });

  it("rejects an unparseable value", () => {
    expect(cardEndpointDefect("not a url")).toMatch(/unparseable/);
  });

  it("accepts a genuinely public endpoint", () => {
    expect(cardEndpointDefect("https://agents.example.com/healthmon/")).toBeNull();
    expect(cardEndpointDefect("http://agents.example.com:8080/a2a")).toBeNull();
    // A public IP is reachable, so it is not a defect even though it is unlovely.
    expect(cardEndpointDefect("http://172.104.171.139/a2a")).toBeNull();
  });

  it("says nothing when no endpoint is declared", () => {
    // A card may legitimately omit url and carry skills or capabilities instead.
    // Absence is not a defect, and inventing one would demote valid agents.
    expect(cardEndpointDefect(undefined)).toBeNull();
    expect(cardEndpointDefect(null)).toBeNull();
    expect(cardEndpointDefect("")).toBeNull();
    expect(cardEndpointDefect("   ")).toBeNull();
    expect(cardEndpointDefect(42)).toBeNull();
  });

  it("does not mistake a public host that merely contains a private-looking string", () => {
    // Substring matching on "10." or "172.16." would flag these wrongly.
    expect(cardEndpointDefect("https://10x.example.com/a2a")).toBeNull();
    expect(cardEndpointDefect("https://node-192.168.example.com/a2a")).toBeNull();
  });
});
