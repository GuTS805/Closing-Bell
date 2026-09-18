import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The dev server runs inside WSL while the browser is on Windows, so requests
  // arrive from the WSL interface address rather than localhost.
  allowedDevOrigins: ["172.21.172.142", "localhost", "127.0.0.1"],
};

export default nextConfig;
