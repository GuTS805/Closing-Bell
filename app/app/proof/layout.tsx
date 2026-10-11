import type { Metadata } from "next";
import { pageMetadata } from "../site-metadata";

export const metadata: Metadata = pageMetadata(
  "/proof",
  "On-Chain Price Guard Proof | Closing Bell",
  "Inspect Solana devnet transactions showing a tokenized-stock price guard accept an in-band test fill and revert a fill outside the oracle band.",
);

export default function ProofLayout({ children }: LayoutProps<"/proof">) {
  return children;
}
