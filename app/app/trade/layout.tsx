import type { Metadata } from "next";
import { pageMetadata } from "../site-metadata";

export const metadata: Metadata = pageMetadata(
  "/trade",
  "Tokenized Stock Trade Calculator | Closing Bell",
  "Compare SPYx, AAPLx, TSLAx, and NVDAx trades with underlying share prices. See pool impact, wrapper premium, and the proposed oracle price band.",
);

export default function TradeLayout({ children }: LayoutProps<"/trade">) {
  return children;
}
