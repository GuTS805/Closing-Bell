import type { MetadataRoute } from "next";
import { SITE_URL } from "./site-metadata";

export default function sitemap(): MetadataRoute.Sitemap {
  return ["/", "/trade", "/position", "/proof", "/findings"].map((path) => ({
    url: new URL(path, SITE_URL).toString(),
  }));
}
