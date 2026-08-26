import type { NextConfig } from "next";
import "./src/env";

const nextConfig: NextConfig = {
  // Self-hosted on Coolify: emit .next/standalone so the runtime image carries
  // only the server and its traced dependencies.
  output: "standalone",
};

export default nextConfig;
