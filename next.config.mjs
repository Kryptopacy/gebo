/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // scripts/ uses .ts extension imports; keep them out of the build graph.
  },
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: false },
  async headers() {
    return [
      // The WebMCP browser API (document.modelContext) is gated on origin
      // isolation; without this header Chrome disables the API on this origin.
      // Nothing here relies on document.domain or cross-origin shared memory,
      // so isolating the origin is free.
      {
        source: "/:path*",
        headers: [{ key: "Origin-Agent-Cluster", value: "?1" }],
      },
    ];
  },
  async rewrites() {
    return [
      // The WebMCP discovery convention probes /.well-known/mcp; the manifest
      // itself is a static file, so serve it at both paths.
      { source: "/.well-known/mcp", destination: "/.well-known/mcp.json" },
    ];
  },
};

export default nextConfig;
