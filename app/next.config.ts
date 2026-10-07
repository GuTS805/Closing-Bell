import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The dev server runs inside WSL while the browser is on Windows, so requests
  // arrive from the WSL interface address rather than localhost.
  allowedDevOrigins: ["172.21.172.142", "localhost", "127.0.0.1"],

  async headers() {
    return [
      {
        // The two read-only endpoints are documented as a public API, so they have to be
        // callable from a browser on someone else's origin. Both are GETs over public
        // chain data with no cookies, session or wallet involved, so there is nothing for
        // a hostile origin to gain by reading them that it could not fetch itself.
        //
        // /api/guard/run is deliberately excluded: it spends devnet SOL and changes state,
        // and no other site needs to trigger that from a browser.
        source: "/api/:path(truecost|position)",
        headers: [
          { key: "Access-Control-Allow-Origin", value: "*" },
          { key: "Access-Control-Allow-Methods", value: "GET, OPTIONS" },
          { key: "Access-Control-Max-Age", value: "86400" },
        ],
      },
    ];
  },
};

export default nextConfig;
