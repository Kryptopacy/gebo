/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // scripts/ uses .ts extension imports; keep them out of the build graph.
  },
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: false },
};

export default nextConfig;
