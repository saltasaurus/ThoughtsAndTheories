import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // standalone output so the prod Docker image ships only what `next start` needs
  output: "standalone",
};

export default nextConfig;
