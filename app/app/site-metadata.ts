import type { Metadata } from "next";

export const SITE_URL = "https://closing-bell-eight.vercel.app";

export const SITE_DESCRIPTION =
  "Compare tokenized stock prices with their underlying shares. Closing Bell shows pool impact, wrapper premium, and on-chain price guard evidence on Solana.";

const image = `${SITE_URL}/icon-512.png`;

export function pageMetadata(path: string, title: string, description: string): Metadata {
  const url = new URL(path, SITE_URL).toString();

  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: {
      type: "website",
      siteName: "Closing Bell",
      title,
      description,
      url,
      images: [{ url: image, width: 512, height: 512, alt: "Closing Bell logo" }],
    },
    twitter: {
      card: "summary",
      title,
      description,
      images: [image],
    },
  };
}
