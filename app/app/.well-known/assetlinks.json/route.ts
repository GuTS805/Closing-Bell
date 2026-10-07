const assetLinks = [
  {
    relation: ["delegate_permission/common.handle_all_urls"],
    target: {
      namespace: "android_app",
      package_name: "com.closingbell.mobile",
      sha256_cert_fingerprints: [
        "5E:87:B6:61:FC:97:F1:71:96:55:C1:7A:BE:25:F7:88:27:76:E9:AD:EC:2B:FF:85:17:CD:4B:6C:46:A8:B4:AB",
      ],
    },
  },
];

export async function GET() {
  return new Response(JSON.stringify(assetLinks), {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800",
    },
  });
}
