/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@stage-pilot/shared"],
  async rewrites() {
    const hub = process.env.HUB_URL || "http://localhost:8787";
    return [
      { source: "/api/hub/:path*", destination: `${hub}/:path*` },
    ];
  },
};
export default nextConfig;
