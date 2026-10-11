import type { Metadata } from "next";
import { pageMetadata } from "../site-metadata";

export const metadata: Metadata = pageMetadata(
  "/position",
  "Tokenized Stock Position Cost | Closing Bell",
  "Look up a Solana wallet's xStock holdings and estimate the wrapper premium in a read-only view. No transaction signature is needed.",
);

export default function PositionLayout({ children }: LayoutProps<"/position">) {
  return children;
}
