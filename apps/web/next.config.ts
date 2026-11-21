import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@hkharp/contracts", "@hkharp/domain", "@hkharp/db"],
  serverExternalPackages: ["mysql2"],
};

export default nextConfig;
