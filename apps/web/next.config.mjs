/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@slidr/shared"],
  async rewrites() {
    const hub = process.env.HUB_URL || "http://localhost:3100";
    return [
      { source: "/api/hub/:path*", destination: `${hub}/:path*` },
    ];
  },
};
export default nextConfig;
