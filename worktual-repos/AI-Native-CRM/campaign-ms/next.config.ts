import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  devIndicators: false,
  serverExternalPackages: ["@prisma/client", "prisma"],
  turbopack: {
    root: path.join(__dirname),
  },
};

export default nextConfig;
